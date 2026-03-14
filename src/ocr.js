const Tesseract = require('tesseract.js');

/**
 * Recognizes text from a base64 encoded image.
 * @param {string} base64Image The base64 encoded image string.
 * @returns {Promise<string>} The recognized text.
 */
async function recognizeText(base64Image) {
  console.log('Recognizing text from image...');
  try {
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
    console.log('Text recognition successful.');
    return text;
  } catch (error) {
    console.error('Error during OCR processing:', error);
    throw new Error('Failed to recognize text from image.');
  }
}

module.exports = { recognizeText };
