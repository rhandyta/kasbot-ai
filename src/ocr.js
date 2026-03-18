const { Jimp, JimpMime } = require('jimp');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { postProcessOcrText } = require('./ocr/postprocess');

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
    .normalize()
    .contrast(0.5)
    .gaussian(1);
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
  let tempFallbackPath = null;
  try {
    const timeoutMs = Math.max(parseInt(process.env.OCR_TIMEOUT_MS || '120000', 10) || 120000, 5000);
    const pythonBin = process.env.PYTHON_BIN || 'python';
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const processedBuffer = await preprocessImage(imageBuffer);

    // Create a temporary file
    const tempDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    tempFilePath = path.join(tempDir, `ocr_${Date.now()}.jpg`);
    fs.writeFileSync(tempFilePath, processedBuffer);

    const runPython = async (filePath) => {
      const pythonScript = path.join(__dirname, 'ocr_easyocr.py');
      const result = await new Promise((resolve, reject) => {
        const python = spawn(pythonBin, [pythonScript, filePath], { windowsHide: true });
        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
          try {
            python.kill();
          } catch {}
          reject(new Error('EasyOCR timeout'));
        }, timeoutMs);

        python.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        python.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        python.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            try {
              const parsed = JSON.parse(stdout);
              resolve(parsed.text || '');
            } catch (e) {
              reject(new Error(`Failed to parse Python output: ${e.message}`));
            }
          } else {
            reject(new Error(`EasyOCR failed with code ${code}: ${stderr || 'No output'}`));
          }
        });
        python.on('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`Failed to spawn Python process: ${err.message}`));
        });
      });
      return result;
    };

    let result = '';
    try {
      result = await runPython(tempFilePath);
    } catch (e) {
      result = '';
    }

    if (!result || result.trim().length === 0) {
      tempFallbackPath = path.join(tempDir, `ocr_raw_${Date.now()}.jpg`);
      fs.writeFileSync(tempFallbackPath, imageBuffer);
      try {
        result = await runPython(tempFallbackPath);
      } catch (e) {
        result = '';
      }
    }

    console.log('Text recognition successful.');
    return postProcessOcrText(result);
  } catch (error) {
    console.error('Error during OCR processing:', error);
    return '';
  } finally {
    // Clean up temporary file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.warn('Could not delete temp file:', e.message);
      }
    }
    if (tempFallbackPath && fs.existsSync(tempFallbackPath)) {
      try {
        fs.unlinkSync(tempFallbackPath);
      } catch (e) {
        console.warn('Could not delete temp file:', e.message);
      }
    }
  }
}

module.exports = { recognizeText };
