# Deployment

## Prerequisites

- WebOS CLI tools installed and available on `PATH`
- A configured target device or emulator via `ares-setup-device`
- The target device reachable over SSH

Useful checks:

```sh
ares-setup-device -F
ares-device -i -d <device-name>
```

If `ares-device -i` returns `ECONNREFUSED`, start the emulator or re-enable Developer Mode / Key Server on the TV before deploying.

## Install Dependencies

```sh
npm install
```

## Build The Package

```sh
npm run package
```

This produces an IPK in `build/`, for example:

```text
build/org.jellyfin.webos_1.2.2_all.ipk
```

## Deploy To The Default Device

`npm run deploy` uses the current default device configured in the WebOS CLI.

```sh
npm run deploy
```

To target a specific configured device profile with the helper script:

```sh
npm run deploy -- emulator
npm run deploy -- tv
```

The current default device can be checked with:

```sh
ares-setup-device -F
```

## Deploy To A Specific Device

```sh
ares-install -d <device-name> build/org.jellyfin.webos_1.2.2_all.ipk
```

Examples:

```sh
ares-install -d emulator build/org.jellyfin.webos_1.2.2_all.ipk
ares-install -d tv build/org.jellyfin.webos_1.2.2_all.ipk
```

## Launch The App

Default device:

```sh
npm run launch
```

Specific device:

```sh
ares-launch -d <device-name> org.jellyfin.webos
```

## Reinstall Cleanly

If the package is already installed, `ares-install` updates it in place. To remove it first:

```sh
ares-install --remove org.jellyfin.webos -d <device-name>
ares-install -d <device-name> build/org.jellyfin.webos_1.2.2_all.ipk
```

## Inspect / Debug

```sh
ares-inspect -d <device-name> org.jellyfin.webos
```

## Typical Local Flow

```sh
npm install
npm run package
ares-device -i -d <device-name>
ares-install -d <device-name> build/org.jellyfin.webos_1.2.2_all.ipk
ares-launch -d <device-name> org.jellyfin.webos
```
