chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchKulasis") {
    fetch(request.url)
      .then(response => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.arrayBuffer();
      })
      .then(buffer => {
        // Convert ArrayBuffer to base64 to send back to content script
        // Content script will handle decoding
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        sendResponse({ success: true, data: base64 });
      })
      .catch(error => {
        console.error("Fetch error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Will respond asynchronously
  }
});
