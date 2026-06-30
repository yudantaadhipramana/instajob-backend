// popup.js - Token validation and storage

const API_BASE = 'https://instajob-backend-production.up.railway.app';

document.getElementById('saveBtn').addEventListener('click', async () => {
  const token = document.getElementById('token').value.trim();
  const statusDiv = document.getElementById('status');

  if (!token) {
    showStatus('Please enter a token', 'error');
    return;
  }

  try {
    // Validate token with backend
    const response = await fetch(`${API_BASE}/api/auth/validate-extension-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      const error = await response.json();
      showStatus(`Token invalid: ${error.error || 'Unknown error'}`, 'error');
      return;
    }

    const data = await response.json();
    
    // Store token in extension storage
    chrome.storage.local.set({
      extensionToken: token,
      userId: data.user.id,
      userEmail: data.user.email,
      activatedAt: new Date().toISOString()
    }, () => {
      showStatus(`✓ Activated for ${data.user.email}`, 'success');
      
      // Clear input
      document.getElementById('token').value = '';
      
      // Close popup after 2 seconds
      setTimeout(() => window.close(), 2000);
    });

  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  }
});

function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = type;
}

// Load saved token on popup open
chrome.storage.local.get(['extensionToken', 'userEmail'], (result) => {
  if (result.extensionToken) {
    document.getElementById('token').placeholder = `Logged in as ${result.userEmail}`;
    document.getElementById('saveBtn').textContent = 'Update Token';
  }
});
