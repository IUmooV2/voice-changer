const path = require("path");
const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");

const engineTarget = process.env.MOOVOICE_ENGINE_URL || "http://127.0.0.1:18888";

// Watchpack reports Windows paths with backslashes. Regexes keep protected
// system files out of its initial scan without disabling project hot reload.
const windowsSystemFiles =
    /^[A-Za-z]:[\\/](?:DumpStack\.log\.tmp|hiberfil\.sys|pagefile\.sys|swapfile\.sys)$/i;

module.exports = merge(common, {
    mode: "development",
    watchOptions: {
        aggregateTimeout: 250,
        poll: 1000,
        followSymlinks: false,
        ignored: [
            /[\\/]node_modules[\\/]/,
            /[\\/]dist[\\/]/,
            /[\\/]logs[\\/]/,
            /[\\/]\.git[\\/]/,
            windowsSystemFiles,
        ],
    },
    devServer: {
        static: {
            directory: path.join(__dirname, "public"),
            watch: false,
        },
        client: {
            overlay: {
                errors: false,
                warnings: false,
            },
        },
        host: "0.0.0.0",
        server: "https",
        proxy: [
            {
                context: [
                    "/info",
                    "/performance",
                    "/update_settings",
                    "/upload_file",
                    "/concat_uploaded_file",
                    "/load_model",
                    "/merge_model",
                    "/update_model_default",
                    "/onnx",
                    "/onnx_export",
                    "/model_type",
                    "/socket.io",
                ],
                target: engineTarget,
                secure: false,
                changeOrigin: true,
                ws: true,
            },
        ],
    },
});
