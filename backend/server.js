require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const agoraRoutes = require('./routes/agora_routes');
const basicAuth = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// IP Whitelist middleware (optional additional security)
const allowedIPs = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : [];
if (allowedIPs.length > 0) {
  app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    if (!allowedIPs.includes(clientIP)) {
      return res.status(403).json({ error: 'Access denied from this IP address' });
    }
    next();
  });
}

// Health check endpoint (no auth required for monitoring)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));
app.use('/src', express.static(path.join(__dirname, '../src')));
app.use('/lib', express.static(path.join(__dirname, '../node_modules'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// Serve VRM avatar model files
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Apply Basic Authentication to API routes only
app.use('/api', basicAuth);

app.use('/api/agora', agoraRoutes);

app.get('/', basicAuth, (req, res) => {
  const indexPath = path.join(__dirname, '../frontend/index.html');
  let html = require('fs').readFileSync(indexPath, 'utf8');

  // Inject authentication credentials into the HTML
  const authScript = `
    <script>
      window.APP_AUTH_USERNAME = ${JSON.stringify(process.env.AUTH_USERNAME || '')};
      window.APP_AUTH_PASSWORD = ${JSON.stringify(process.env.AUTH_PASSWORD || '')};
    </script>
  `;

  // Insert the auth script before the closing head tag
  html = html.replace('</head>', `${authScript}</head>`);

  res.send(html);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend available at http://localhost:${PORT}`);
});

module.exports = app;
