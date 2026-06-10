const dotenv = require("dotenv");
const app = require("./app");
const { testConnection } = require("./config/db");

dotenv.config();

const PORT = Number(process.env.PORT || 5000);

const startServer = async () => {
  try {
    await testConnection();
    app.listen(PORT, () => {
      console.log(`Fumba Port WMS backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Unable to start backend server:", error.message);
    process.exit(1);
  }
};

startServer();
