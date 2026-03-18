const crypto = require('crypto');
const { pool } = require('./pool');
const { ensureSchema } = require('./schema');
const { logAudit } = require('./audit');

function generateShareToken() {
  return crypto.randomBytes(18).toString('base64url');
}

async function ensureUserSettingsRow(userId) {
  const sql = `
    INSERT INTO user_settings (user_id, currency)
    VALUES (?, 'IDR')
    ON DUPLICATE KEY UPDATE user_id = user_id
  `;
  await pool.execute(sql, [userId]);
}

async function getUserMemberships(userId) {
  const sql = `
    SELECT am.account_id, am.role, am.can_write, a.share_token
    FROM account_members am
    JOIN accounts a ON a.id = am.account_id
    WHERE am.user_id = ?
    ORDER BY am.role = 'owner' DESC, am.id ASC
  `;
  const [rows] = await pool.execute(sql, [userId]);
  return rows;
}

async function getAccountMemberRole(accountId, userId) {
  const [rows] = await pool.execute(
    `SELECT role, can_write FROM account_members WHERE account_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`,
    [accountId, userId],
  );
  if (rows.length === 0) return null;
  return { role: rows[0].role, canWrite: !!rows[0].can_write };
}

async function assertOwner(accountId, userId) {
  await ensureSchema();
  const member = await getAccountMemberRole(accountId, userId);
  if (!member || member.role !== 'owner') {
    throw new Error('Khusus owner.');
  }
}

async function createAccountAndSetActive(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);

  let token = generateShareToken();
  let accountId = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      const [result] = await pool.execute(`INSERT INTO accounts (share_token) VALUES (?)`, [token]);
      accountId = result.insertId;
      break;
    } catch (e) {
      if (!e || e.code !== 'ER_DUP_ENTRY') throw e;
      token = generateShareToken();
    }
  }
  if (!accountId) throw new Error('Gagal membuat akun baru.');

  await pool.execute(
    `INSERT INTO account_members (user_id, account_id, role, can_write) VALUES (?, ?, 'owner', 1)`,
    [userId, accountId],
  );
  await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
    accountId,
    userId,
  ]);
  await logAudit(accountId, userId, 'account_create', 'account', String(accountId), {});
  return { accountId, token };
}

async function getActiveAccountId(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);

  const [settingsRows] = await pool.execute(
    `SELECT active_account_id FROM user_settings WHERE user_id = ?`,
    [userId],
  );
  const activeAccountId = settingsRows[0]?.active_account_id || null;
  if (activeAccountId) return activeAccountId;

  const memberships = await getUserMemberships(userId);
  if (memberships.length > 0) {
    const accountId = memberships[0].account_id;
    await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
      accountId,
      userId,
    ]);
    return accountId;
  }

  const [memberCountRows] = await pool.execute(`SELECT COUNT(*) AS cnt FROM account_members`);
  const hasAnyMember = (memberCountRows[0]?.cnt || 0) > 0;
  const [txCountRows] = await pool.execute(`SELECT COUNT(*) AS cnt FROM transactions`);
  const hasAnyTransaction = (txCountRows[0]?.cnt || 0) > 0;

  if (!hasAnyMember && hasAnyTransaction) {
    const [accountRows] = await pool.execute(`SELECT id FROM accounts WHERE id = 1 LIMIT 1`);
    if (accountRows.length === 0) {
      await pool.execute(`INSERT INTO accounts (id, share_token) VALUES (1, ?)`, [generateShareToken()]);
    }
    await pool.execute(
      `INSERT INTO account_members (user_id, account_id, role, can_write) VALUES (?, 1, 'owner', 1)`,
      [userId],
    );
    await pool.execute(`UPDATE user_settings SET active_account_id = 1 WHERE user_id = ?`, [userId]);
    return 1;
  }

  const created = await createAccountAndSetActive(userId);
  return created.accountId;
}

async function getActiveAccountContext(userId) {
  const accountId = await getActiveAccountId(userId);
  const sql = `
    SELECT role, can_write
    FROM account_members
    WHERE user_id = ? AND account_id = ?
    ORDER BY id DESC
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [userId, accountId]);
  const role = rows[0]?.role || 'viewer';
  const canWrite = !!rows[0]?.can_write;
  return { accountId, role, canWrite };
}

async function getActiveAccountToken(userId) {
  const { accountId, role } = await getActiveAccountContext(userId);
  if (role !== 'owner') throw new Error('Token hanya bisa dilihat oleh pemilik akun.');
  const [rows] = await pool.execute(`SELECT share_token FROM accounts WHERE id = ?`, [accountId]);
  if (rows.length === 0) throw new Error('Akun tidak ditemukan.');
  return { accountId, token: rows[0].share_token };
}

async function rotateActiveAccountToken(userId) {
  const { accountId, role } = await getActiveAccountContext(userId);
  if (role !== 'owner') throw new Error('Token hanya bisa di-reset oleh pemilik akun.');
  const token = generateShareToken();
  await pool.execute(`UPDATE accounts SET share_token = ? WHERE id = ?`, [token, accountId]);
  await logAudit(accountId, userId, 'token_rotate', 'account', String(accountId), {});
  return { accountId, token };
}

async function joinAccountByToken(userId, token) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);

  const [inviteRows] = await pool.execute(
    `SELECT id, account_id, role, can_write
     FROM account_invites
     WHERE invite_token = ?
       AND revoked_at IS NULL
       AND used_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [token],
  );

  if (inviteRows.length > 0) {
    const invite = inviteRows[0];
    const accountId = invite.account_id;
    await pool.execute(
      `INSERT INTO account_members (user_id, account_id, role, can_write)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), can_write = VALUES(can_write)`,
      [userId, accountId, invite.role, invite.can_write],
    );
    await pool.execute(`UPDATE account_invites SET used_by_user_id = ?, used_at = NOW() WHERE id = ?`, [
      userId,
      invite.id,
    ]);
    await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
      accountId,
      userId,
    ]);
    await logAudit(accountId, userId, 'invite_join', 'invite', String(invite.id), {});
    return { accountId };
  }

  const [rows] = await pool.execute(`SELECT id FROM accounts WHERE share_token = ? LIMIT 1`, [token]);
  if (rows.length === 0) throw new Error('Token tidak ditemukan.');
  const accountId = rows[0].id;

  await pool.execute(
    `INSERT INTO account_members (user_id, account_id, role, can_write)
     VALUES (?, ?, 'viewer', 0)
     ON DUPLICATE KEY UPDATE role = VALUES(role), can_write = VALUES(can_write)`,
    [userId, accountId],
  );
  await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
    accountId,
    userId,
  ]);
  await logAudit(accountId, userId, 'token_join', 'account', String(accountId), {});
  return { accountId };
}

async function listUserAccounts(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);
  const memberships = await getUserMemberships(userId);
  const [settingsRows] = await pool.execute(
    `SELECT active_account_id FROM user_settings WHERE user_id = ?`,
    [userId],
  );
  const activeAccountId = settingsRows[0]?.active_account_id || null;
  return memberships.map((m) => ({
    accountId: m.account_id,
    role: m.role,
    canWrite: !!m.can_write,
    isActive: activeAccountId === m.account_id,
  }));
}

async function setActiveAccount(userId, accountId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);
  const [rows] = await pool.execute(
    `SELECT 1 FROM account_members WHERE user_id = ? AND account_id = ? LIMIT 1`,
    [userId, accountId],
  );
  if (rows.length === 0) throw new Error('Kamu tidak punya akses ke akun itu.');
  await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
    accountId,
    userId,
  ]);
  await logAudit(accountId, userId, 'account_switch', 'account', String(accountId), {});
  return { accountId };
}

async function switchToOwnedAccount(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);
  const [rows] = await pool.execute(
    `SELECT account_id FROM account_members WHERE user_id = ? AND role = 'owner' ORDER BY id ASC LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) {
    const created = await createAccountAndSetActive(userId);
    return { accountId: created.accountId };
  }
  const accountId = rows[0].account_id;
  await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
    accountId,
    userId,
  ]);
  await logAudit(accountId, userId, 'account_switch_owned', 'account', String(accountId), {});
  return { accountId };
}

async function createInvite(accountId, actorUserId, { role = 'viewer', canWrite = 0, expiresDays = null } = {}) {
  await assertOwner(accountId, actorUserId);
  let token = generateShareToken();
  for (let i = 0; i < 3; i += 1) {
    try {
      const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 86400 * 1000) : null;
      const [result] = await pool.execute(
        `INSERT INTO account_invites (invite_token, account_id, role, can_write, created_by_user_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [token, accountId, role, canWrite ? 1 : 0, actorUserId, expiresAt],
      );
      await logAudit(accountId, actorUserId, 'invite_create', 'invite', String(result.insertId), {
        role,
        can_write: !!canWrite,
        expires_days: expiresDays,
      });
      return { inviteId: result.insertId, token };
    } catch (e) {
      if (!e || e.code !== 'ER_DUP_ENTRY') throw e;
      token = generateShareToken();
    }
  }
  throw new Error('Gagal membuat invite.');
}

async function listInvites(accountId, actorUserId) {
  await assertOwner(accountId, actorUserId);
  const [rows] = await pool.execute(
    `SELECT id, invite_token, role, can_write, created_at, expires_at, used_by_user_id, used_at, revoked_at
     FROM account_invites
     WHERE account_id = ?
     ORDER BY id DESC`,
    [accountId],
  );
  return rows;
}

async function revokeInvite(accountId, actorUserId, inviteId) {
  await assertOwner(accountId, actorUserId);
  await pool.execute(`UPDATE account_invites SET revoked_at = NOW() WHERE account_id = ? AND id = ?`, [
    accountId,
    inviteId,
  ]);
  await logAudit(accountId, actorUserId, 'invite_revoke', 'invite', String(inviteId), {});
}

async function listMembers(accountId, actorUserId) {
  await assertOwner(accountId, actorUserId);
  const [rows] = await pool.execute(
    `SELECT user_id, role, can_write, created_at
     FROM account_members
     WHERE account_id = ?
     ORDER BY role = 'owner' DESC, created_at ASC`,
    [accountId],
  );
  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role,
    can_write: !!r.can_write,
    created_at: r.created_at,
  }));
}

async function revokeMember(accountId, actorUserId, memberUserId) {
  await assertOwner(accountId, actorUserId);
  const member = await getAccountMemberRole(accountId, memberUserId);
  if (!member) throw new Error('Member tidak ditemukan.');
  if (member.role === 'owner') throw new Error('Tidak bisa mencabut owner.');
  await pool.execute(`DELETE FROM account_members WHERE account_id = ? AND user_id = ?`, [
    accountId,
    memberUserId,
  ]);
  await logAudit(accountId, actorUserId, 'member_revoke', 'account_member', memberUserId, {});
}

module.exports = {
  ensureUserSettingsRow,
  getActiveAccountContext,
  getActiveAccountToken,
  rotateActiveAccountToken,
  joinAccountByToken,
  createAccountAndSetActive,
  listUserAccounts,
  setActiveAccount,
  switchToOwnedAccount,
  createInvite,
  listInvites,
  revokeInvite,
  listMembers,
  revokeMember,
};
