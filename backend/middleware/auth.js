/**
 * HTTP Basic Authentication Middleware
 * Protects the application with a simple username/password challenge
 */

const basicAuth = (req, res, next) => {
  // Skip auth if credentials are not configured (for development)
  if (!process.env.AUTH_USERNAME || !process.env.AUTH_PASSWORD) {
    console.warn('⚠️  AUTH_USERNAME or AUTH_PASSWORD not set - authentication disabled');
    return next();
  }

  // Parse the Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    // No credentials provided - request authentication
    res.setHeader('WWW-Authenticate', 'Basic realm="AI Anime Girlfriend Demo"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Decode credentials
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // Verify credentials
  if (username === process.env.AUTH_USERNAME && password === process.env.AUTH_PASSWORD) {
    // Authentication successful
    return next();
  }

  // Invalid credentials
  res.setHeader('WWW-Authenticate', 'Basic realm="AI Anime Girlfriend Demo"');
  return res.status(401).json({ error: 'Invalid credentials' });
};

module.exports = basicAuth;
