const Tesseract = require('tesseract.js');
const { Jimp, JimpMime } = require('jimp');

/**
 * Preprocess image to improve OCR accuracy.
 * @param {Buffer} buffer Image buffer.
 * @returns {Promise<Buffer>} Processed image buffer.
 */
async function preprocessImage(buffer) {
  const image = await Jimp.read(buffer);
  image
    .greyscale()                 // grayscale
    .contrast(0.5)               // increase contrast
    .threshold({ max: 128 });    // binarization
  return await image.getBuffer(JimpMime.jpeg);
}

/**
 * Recognizes text from a base64 encoded image.
 * @param {string} base64Image The base64 encoded image string.
 * @returns {Promise<string>} The recognized text.
 */
async function recognizeText(base64Image) {
  console.log('Recognizing text from image...');
  try {
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const processedBuffer = await preprocessImage(imageBuffer);
    const { data: { text } } = await Tesseract.recognize(processedBuffer, 'eng');
    console.log('Text recognition successful.');
    return text;
  } catch (error) {
    console.error('Error during OCR processing:', error);
    throw new Error('Failed to recognize text from image.');
  }
}

module.exports = { recognizeText };
