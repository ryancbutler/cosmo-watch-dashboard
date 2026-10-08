/** @param {string} [value] */
export function dashboardAuthEnabled(value) {
    if (value === undefined || value === '' || value === 'true') return true;
    if (value === 'false') return false;
    throw new Error('DASHBOARD_AUTH_ENABLED must be true or false.');
}
