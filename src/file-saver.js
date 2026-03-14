const fs = require('fs/promises');
const path = require('path');

/**
 * Saves a media file from a WhatsApp message to the local filesystem.
 * @param {MessageMedia} media The media object from whatsapp-web.js.
 * @returns {Promise<string>} The public path to the saved file.
 */
async function saveReceipt(media) {
  try {
    const fileExtension = media.mimetype.split('/')[1];
    const filename = `receipt-${Date.now()}.${fileExtension}`;
    const directory = path.join(__dirname, '..', 'public', 'uploads');
    const filePath = path.join(directory, filename);

    // Ensure the directory exists
    await fs.mkdir(directory, { recursive: true });

    const buffer = Buffer.from(media.data, 'base64');
    await fs.writeFile(filePath, buffer);
    
    const publicPath = `/uploads/${filename}`;
    console.log(`Receipt saved to: ${publicPath}`);
    return publicPath;
  } catch (error) {
    console.error('Error saving receipt file:', error);
    throw new Error('Failed to save receipt file.');
  }
}

module.exports = { saveReceipt };
