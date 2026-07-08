const dotenv = require("dotenv");
const http = require("http");
const app = require("./app");
const { testConnection } = require("./config/db");
const { initSocketServer } = require("./realtime/socketServer");

dotenv.config();

const PORT = Number(process.env.PORT || 5000);

const startServer = async () => {
  try {
    await testConnection();
    const server = http.createServer(app);
    initSocketServer(server);

    server.listen(PORT, () => {
      console.log(`Fumba Port WMS backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Unable to start backend server:", error.message);
    process.exit(1);
  }
};

startServer();
