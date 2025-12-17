/**
 * SiteManager+ Demo Site - Client-side Script
 * Shows how to interact with admin and monitoring endpoints
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('SiteManager+ Demo Site loaded');
    
    // Simulate monitoring data fetch (in real implementation)
    if (window.location.pathname === '/admin') {
        console.log('Admin panel loaded - use admin credentials to access');
    }
});

/**
 * Helper function to make API calls to admin panel
 */
function callAdminAPI(endpoint, method = 'GET', body = null) {
    const username = prompt('Admin username:');
    const password = prompt('Admin password:');
    
    if (!username || !password) return;

    const auth = 'Basic ' + btoa(username + ':' + password);

    const options = {
        method,
        headers: {
            'Authorization': auth,
            'Content-Type': 'application/json',
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    fetch(endpoint, options)
        .then(res => res.json())
        .then(data => {
            console.log('API Response:', data);
            alert('Response: ' + JSON.stringify(data, null, 2));
        })
        .catch(err => {
            console.error('API Error:', err);
            alert('Error: ' + err.message);
        });
}

/**
 * Example: Get system status from admin API
 */
window.getSystemStatus = () => {
    callAdminAPI('/admin/status');
};

/**
 * Example: Toggle maintenance mode
 */
window.toggleMaintenance = () => {
    const reason = prompt('Reason for maintenance:');
    if (!reason) return;
    
    callAdminAPI('/admin/maintenance/toggle', 'POST', {
        reason: reason,
        durationMinutes: 15,
    });
};

/**
 * Example: Get worker information
 */
window.getWorkerInfo = () => {
    callAdminAPI('/admin/workers');
};
