export interface UserSession {
  username: string;
  role: 'admin' | 'viewer';
  authenticatedAt: string;
}

export function verifyCredentials(username: string, password: string): UserSession | null {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin2026';
  const viewerUser = process.env.VIEWER_USERNAME || 'viewer';
  const viewerPass = process.env.VIEWER_PASSWORD || 'viewer2026';

  if (username === adminUser && password === adminPass) {
    return { username, role: 'admin', authenticatedAt: new Date().toISOString() };
  }
  if (username === viewerUser && password === viewerPass) {
    return { username, role: 'viewer', authenticatedAt: new Date().toISOString() };
  }
  return null;
}
