// content.js - LinkedIn job scraper (Part 1: Token retrieval + helpers)

const API_BASE = 'https://instajob-backend-production.up.railway.app';

// Get stored token from extension storage
async function getStoredToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['extensionToken'], (result) => {
      resolve(result.extensionToken || null);
    });
  });
}

// Send job data to InstaJob backend
async function submitJobToBackend(jobData, token) {
  try {
    const response = await fetch(`${API_BASE}/api/discovered-jobs/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        jobs: [jobData],
        source: 'linkedin_extension',
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      console.error('Failed to submit job:', response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error submitting job:', error);
    return false;
  }
}

// Extract job listing from LinkedIn page
function extractJobData() {
  try {
    // LinkedIn job listing selectors (these may need updating based on LinkedIn UI changes)
    const jobTitle = document.querySelector('.jobs-details-top-card__job-title')?.textContent || 'Unknown';
    const company = document.querySelector('.jobs-details-top-card__company-name')?.textContent || 'Unknown';
    const location = document.querySelector('[data-test-id="job-details-how-you-were-found"]')?.textContent || 'Unknown';
    const jobDescription = document.querySelector('.show-more-less-html__markup')?.textContent || '';
    
    // Extract job ID from URL
    const jobId = new URL(window.location).searchParams.get('currentJobId') || 'unknown';

    return {
      title: jobTitle.trim(),
      company: company.trim(),
      location: location.trim(),
      description: jobDescription.trim().substring(0, 5000),
      linkedinJobId: jobId,
      linkedinUrl: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error extracting job data:', error);
    return null;
  }
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeCurrentJob') {
    (async () => {
      const token = await getStoredToken();
      
      if (!token) {
        sendResponse({ success: false, error: 'No token found. Please activate extension first.' });
        return;
      }

      const jobData = extractJobData();
      if (!jobData) {
        sendResponse({ success: false, error: 'Could not extract job data' });
        return;
      }

      const success = await submitJobToBackend(jobData, token);
      sendResponse({ 
        success, 
        message: success ? 'Job saved successfully' : 'Failed to save job'
      });
    })();

    return true; // Keep channel open for async response
  }
});
