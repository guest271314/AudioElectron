const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Function to create the main window
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
}

// Create the main window when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Activate the main window when the app is activated, except on macOS
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('save-audio', async (event, buffer) => {
  try {
      const filename = 'audio.wav'; // Specify the desired filename and extension
      const filePath = path.join(__dirname, filename); // Get the full path within the working directory

      // Write the buffer data to a file
      fs.writeFile(filePath, Buffer.from(buffer), (err) => {
          if (err) {
              console.error('Error writing file:', err);
              event.reply('save-audio-response', { success: false, error: err.message });
          } else {
              console.log('File saved successfully:', filePath);
              event.reply('save-audio-response', { success: true, filename: filePath });
          }
      });
  } catch (error) {
      console.error('Error:', error);
      event.reply('save-audio-response', { success: false, error: error.message });
  }
});


class WavAudioEncoder {
  constructor({ sampleRate, numberOfChannels }) {
    let controller;
    let readable = new ReadableStream({
      start(c) {
        return (controller = c);
      },
    });
    Object.assign(this, {
      sampleRate,
      numberOfChannels,
      numberOfSamples: 0,
      dataViews: [],
      controller,
      readable,
    });
  }
  write(buffer) {
    const floats = new Float32Array(buffer);
    let channels;
    // Deinterleave
    if (this.numberOfChannels > 1) {
      channels = [[], []];
      for (let i = 0, j = 0, n = 1; i < floats.length; i++) {
        channels[(n = ++n % 2)][!n ? j++ : j - 1] = floats[i];
      }
      channels = channels.map((f) => new Float32Array(f));
    } else {
      channels = [floats];
    }
    const [{ length }] = channels;
    const ab = new ArrayBuffer(length * this.numberOfChannels * 2);
    const data = new DataView(ab);
    let offset = 0;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < this.numberOfChannels; ch++) {
        let x = channels[ch][i] * 0x7fff;
        data.setInt16(
          offset,
          x < 0 ? Math.max(x, -0x8000) : Math.min(x, 0x7fff),
          true
        );
        offset += 2;
      }
    }
    this.controller.enqueue(new Uint8Array(ab));
    this.numberOfSamples += length;
  }
  setString(view, offset, str) {
    const len = str.length;
    for (let i = 0; i < len; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
  async encode() {
    const dataSize = this.numberOfChannels * this.numberOfSamples * 2;
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    this.setString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.setString(view, 8, 'WAVE');
    this.setString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, this.numberOfChannels, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * 4, true);
    view.setUint16(32, this.numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    this.setString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    this.controller.close();
    return new Blob(
      [
        buffer,
        await new Response(this.readable, {
          cache: 'no-store',
        }).arrayBuffer(),
      ],
      {
        type: 'audio/wav',
      }
    );
  }
}
