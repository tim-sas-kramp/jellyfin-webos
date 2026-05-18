const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const buildDir = path.join(__dirname, '..', 'build');
const requestedDevice = process.argv[2];

function getLatestIpk() {
    const files = fs.readdirSync(buildDir)
        .filter(file => /^org\.jellyfin\.webos_.*_all\.ipk$/.test(file))
        .sort((left, right) => {
            const leftTime = fs.statSync(path.join(buildDir, left)).mtimeMs;
            const rightTime = fs.statSync(path.join(buildDir, right)).mtimeMs;
            return rightTime - leftTime;
        });

    if (!files.length) {
        throw new Error('No packaged IPK found in build/. Run "npm run package" first.');
    }

    return path.join(buildDir, files[0]);
}

function main() {
    const ipkPath = getLatestIpk();
    let command;
    let args;

    console.log('Deploying:', ipkPath);
    if (requestedDevice) {
        console.log('Target device:', requestedDevice);
    } else {
        console.log('Target device: default ares target');
    }

    if (process.platform === 'win32') {
        command = 'pwsh';
        args = [
            '-NoProfile',
            '-File',
            path.join(process.env.APPDATA, 'npm', 'ares-install.ps1')
        ];

        if (requestedDevice) {
            args.push('-d', requestedDevice);
        }

        args.push(ipkPath);
    } else {
        command = 'ares-install';
        args = [];

        if (requestedDevice) {
            args.push('-d', requestedDevice);
        }

        args.push(ipkPath);
    }

    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: false
    });

    if (result.error) {
        throw result.error;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
        process.exit(result.status);
    }
}

main();
