const { Jimp, JimpMime } = require('jimp');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Preprocess image to improve OCR accuracy.
 * @param {Buffer} buffer Image buffer.
 * @returns {Promise<Buffer>} Processed image buffer.
 */
async function preprocessImage(buffer) {
  const image = await Jimp.read(buffer);
  
  // Resize to a width of at least 1500px for better OCR if it's smaller
  if (image.width < 1500) {
    image.resize({ w: 1500 });
  }

  image
    .greyscale()                 // grayscale
    .contrast(0.5);               // increase contrast
  return await image.getBuffer(JimpMime.jpeg);
}

/**
 * Recognizes text from a base64 encoded image using EasyOCR (Python).
 * @param {string} base64Image The base64 encoded image string.
 * @returns {Promise<string>} The recognized text.
 */
async function recognizeText(base64Image) {
  console.log('Recognizing text from image with EasyOCR...');
  let tempFilePath = null;
  try {
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const processedBuffer = await preprocessImage(imageBuffer);

    // Create a temporary file
    const tempDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    tempFilePath = path.join(tempDir, `ocr_${Date.now()}.jpg`);
    fs.writeFileSync(tempFilePath, processedBuffer);

    // Run Python script
    const pythonScript = path.join(__dirname, 'ocr_easyocr.py');
    const result = await new Promise((resolve, reject) => {
      const python = spawn('python', [pythonScript, tempFilePath]);
      let stdout = '';
      let stderr = '';
      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      python.on('close', (code) => {
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout);
            resolve(parsed.text);
          } catch (e) {
            reject(new Error(`Failed to parse Python output: ${e.message}`));
          }
        } else {
          reject(new Error(`EasyOCR failed with code ${code}: ${stderr || 'No output'}`));
        }
      });
      python.on('error', (err) => {
        reject(new Error(`Failed to spawn Python process: ${err.message}`));
      });
    });

    console.log('Text recognition successful.');
    return result;
  } catch (error) {
    console.error('Error during OCR processing:', error);
    throw new Error('Failed to recognize text from image.');
  } finally {
    // Clean up temporary file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.warn('Could not delete temp file:', e.message);
      }
    }
  }
}

module.exports = { recognizeText };
