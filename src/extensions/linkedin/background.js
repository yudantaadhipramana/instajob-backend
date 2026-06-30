// background.js - Service worker for extension lifecycle management

// Listen for extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('InstaJob extension installed');
    // Could open onboarding page here if needed
  } else if (details.reason === 'update') {
    console.log('InstaJob extension updated');
  }
});

// Periodic token validation (optional - every 6 hours)
chrome.alarms.create('validateToken', { periodInMinutes: 360 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'validateToken') {
    chrome.storage.local.get(['extensionToken'], (result) => {
      if (result.extensionToken) {
        validateTokenWithBackend(result.extensionToken);
      }
    });
  }
});

async function validateTokenWithBackend(token) {
  try {
    const response = await fetch('https://instajob-backend-production.up.railway.app/api/auth/validate-extension-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      // Token expired - clear storage
      chrome.storage.local.clear();
      console.log('Extension token expired and cleared');
    }
  } catch (error) {
    console.error('Token validation error:', error);
  }
}
