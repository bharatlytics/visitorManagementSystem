/**
 * Local Development Server
 * Runs the Express app on port 5001 for local development
 */
const app = require('../api/index.js');

const PORT = process.env.PORT || 5001;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 VMS Backend running at http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   API health:   http://localhost:${PORT}/api/health`);
    console.log(`\n📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});
