const {
  getActiveAccountToken,
  rotateActiveAccountToken,
  joinAccountByToken,
  listUserAccounts,
  setActiveAccount,
  createAccountAndSetActive,
  switchToOwnedAccount,
  createInvite,
  listInvites,
  revokeInvite,
  listMembers,
  revokeMember,
} = require('../db');

async function handleTokenShow(message, senderId) {
  try {
    const { token } = await getActiveAccountToken(senderId);
    await message.reply(
      `🔑 Token akun kamu:\n${token}\n\nBagikan token ini kalau orang lain mau monitoring pencatatan kamu.\nMereka bisa kirim: "pakai token ${token}"`,
    );
  } catch (error) {
    await message.reply(error.message || 'Gagal mengambil token.');
  }
}

async function handleTokenReset(message, senderId) {
  try {
    const { token } = await rotateActiveAccountToken(senderId);
    await message.reply(
      `🔁 Token berhasil di-reset.\nToken baru:\n${token}\n\nYang punya token lama tidak bisa akses lagi.`,
    );
  } catch (error) {
    await message.reply(error.message || 'Gagal reset token.');
  }
}

async function handleJoinToken(message, senderId, token) {
  if (!token) {
    await message.reply('Format: "pakai token <token>"');
    return;
  }
  try {
    await joinAccountByToken(senderId, token);
    await message.reply(
      '✅ Berhasil masuk ke akun tersebut. Kamu sekarang mode monitoring (read-only). Kirim "monitor off" untuk kembali ke akun kamu.',
    );
  } catch (error) {
    await message.reply(error.message || 'Gagal memakai token.');
  }
}

async function handleMonitorOff(message, senderId) {
  try {
    await switchToOwnedAccount(senderId);
    await message.reply('✅ Kembali ke akun kamu.');
  } catch (error) {
    await message.reply(error.message || 'Gagal kembali ke akun kamu.');
  }
}

async function handleAccountList(message, senderId) {
  try {
    const accounts = await listUserAccounts(senderId);
    if (accounts.length === 0) {
      await message.reply('Belum ada akun. Kirim "akun baru" untuk membuat pencatatan baru.');
      return;
    }
    let reply = '🗂️ *Daftar akun kamu:*\n\n';
    accounts.forEach((a, idx) => {
      const activeMark = a.isActive ? ' (aktif)' : '';
      const mode = a.canWrite ? 'owner' : 'viewer';
      reply += `${idx + 1}. Akun #${a.accountId} - ${mode}${activeMark}\n`;
    });
    reply += `\nPilih akun: "akun pilih <nomor>"\nBuat akun baru: "akun baru"`;
    await message.reply(reply);
  } catch (error) {
    await message.reply(error.message || 'Gagal menampilkan akun.');
  }
}

async function handleAccountNew(message, senderId) {
  try {
    await createAccountAndSetActive(senderId);
    await message.reply(
      '✅ Akun baru dibuat dan dijadikan akun aktif. Kirim "token" untuk lihat token dan share ke orang lain.',
    );
  } catch (error) {
    await message.reply(error.message || 'Gagal membuat akun baru.');
  }
}

async function handleAccountPick(message, senderId, idx) {
  if (!Number.isFinite(idx) || idx < 1) {
    await message.reply('Format: "akun pilih <nomor>" (contoh: akun pilih 1)');
    return;
  }
  try {
    const accounts = await listUserAccounts(senderId);
    if (accounts.length === 0) {
      await message.reply('Belum ada akun. Kirim "akun baru" untuk membuat pencatatan baru.');
      return;
    }
    if (idx > accounts.length) {
      await message.reply(`Nomor akun tidak valid. Pilih 1 sampai ${accounts.length}.`);
      return;
    }
    const chosen = accounts[idx - 1];
    await setActiveAccount(senderId, chosen.accountId);
    await message.reply(`✅ Akun aktif diubah ke Akun #${chosen.accountId}.`);
  } catch (error) {
    await message.reply(error.message || 'Gagal memilih akun.');
  }
}

async function handleInvite(message, senderId, accountId, rawMessageBody) {
  const parts = rawMessageBody.trim().split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();

  if (sub === 'list') {
    try {
      const invites = await listInvites(accountId, senderId);
      if (invites.length === 0) {
        await message.reply('Belum ada invite.');
        return;
      }
      let txt = '📨 *Invite*\n\n';
      invites.forEach((inv) => {
        const status = inv.revoked_at
          ? 'revoked'
          : inv.used_at
            ? `used by ${inv.used_by_user_id}`
            : 'active';
        const mode = inv.can_write ? 'editor' : 'viewer';
        txt += `- ID ${inv.id}: ${mode} (${status})\n  token: ${inv.invite_token}\n`;
      });
      await message.reply(txt);
    } catch (e) {
      await message.reply(e.message || 'Gagal ambil invite.');
    }
    return;
  }

  if (sub === 'cabut') {
    const id = parseInt(parts[2], 10);
    if (!Number.isFinite(id)) {
      await message.reply('Format: "invite cabut <id>"');
      return;
    }
    try {
      await revokeInvite(accountId, senderId, id);
      await message.reply(`✅ Invite ID ${id} dicabut.`);
    } catch (e) {
      await message.reply(e.message || 'Gagal cabut invite.');
    }
    return;
  }

  const mode = sub === 'editor' ? 'editor' : 'viewer';
  try {
    const created = await createInvite(accountId, senderId, {
      role: 'viewer',
      canWrite: mode === 'editor' ? 1 : 0,
      expiresDays: 30,
    });
    await message.reply(
      `✅ Invite dibuat (${mode}).\nToken:\n${created.token}\n\nOrang lain bisa kirim: "pakai token ${created.token}"`,
    );
  } catch (e) {
    await message.reply(e.message || 'Gagal membuat invite.');
  }
}

async function handleAccess(message, senderId, accountId, rawMessageBody) {
  const parts = rawMessageBody.trim().split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();

  if (sub === 'list' || sub === '') {
    try {
      const members = await listMembers(accountId, senderId);
      if (members.length === 0) {
        await message.reply('Belum ada member.');
        return;
      }
      let txt = '👥 *Akses Akun*\n\n';
      members.forEach((m) => {
        const mode = m.role === 'owner' ? 'owner' : (m.can_write ? 'editor' : 'viewer');
        txt += `- ${m.user_id}: ${mode}\n`;
      });
      txt += `\nCabut akses: "akses cabut <user_id>"`;
      await message.reply(txt);
    } catch (e) {
      await message.reply(e.message || 'Gagal ambil akses.');
    }
    return;
  }

  if (sub === 'cabut') {
    const userId = parts.slice(2).join(' ').trim();
    if (!userId) {
      await message.reply('Format: "akses cabut <user_id>"');
      return;
    }
    try {
      await revokeMember(accountId, senderId, userId);
      await message.reply(`✅ Akses dicabut untuk ${userId}.`);
    } catch (e) {
      await message.reply(e.message || 'Gagal cabut akses.');
    }
    return;
  }

  await message.reply('Perintah akses: "akses list" atau "akses cabut <user_id>"');
}

async function handleHelp(message, canWrite) {
  const mode = canWrite ? 'owner' : 'monitor';
  let txt = `📌 *Menu (${mode})*\n\n`;
  txt += `- laporan\n- detail (saat diminta)\n- cari <keyword>\n- export <periode>\n- struk terakhir\n\n`;
  if (canWrite) {
    txt += `- kirim teks transaksi atau foto struk\n- undo / batal\n- edit transaksi terakhir jumlah <angka>\n- set currency <IDR|USD|EUR>\n\n`;
    txt += `- budget set <kategori> <jumlah>\n- budget list\n\n`;
    txt += `- ulang tambah <in|out> <jumlah> <kategori> ; <keterangan> ; <tgl 1-28>\n- ulang list\n- ulang hapus <id>\n\n`;
    txt += `- token\n- token reset\n- invite\n- invite editor\n- invite list\n- invite cabut <id>\n- akses list\n- akses cabut <user_id>\n`;
  } else {
    txt += `- monitor off\n`;
  }
  await message.reply(txt);
}

module.exports = {
  handleTokenShow,
  handleTokenReset,
  handleJoinToken,
  handleMonitorOff,
  handleAccountList,
  handleAccountNew,
  handleAccountPick,
  handleInvite,
  handleAccess,
  handleHelp,
};
