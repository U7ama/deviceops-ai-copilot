# Acoustic analysis and mobile incident photos

## Acoustic spectrum demonstration

In Operations → Enterprise, upload `fixtures/enterprise/fan-vibration.csv` to an incident. After processing succeeds, choose **Load acoustic spectrum analysis**, select only that CSV and run isolated analysis as a manager. The preset clears old artifact selections to avoid analyzing an unrelated telemetry file.

The original synthetic CSV contains 4,096 uniform samples at 16 kHz, a baseline near 200 Hz and an injected 3.2 kHz tone. Actual verification measured 3199.219 Hz with 3.906 Hz bin resolution. The output includes statistics and a waveform/spectrum comparison PNG. It is a spectral observation, not a trained bearing-failure classifier. WAV/microphone ingestion is not included; the supported input is a waveform CSV with `time_seconds`, `baseline_amplitude` and `observed_amplitude`.

The preset rejects missing columns, non-finite values, uneven timestamps, more than one CSV and inputs outside 64–262,144 samples. Existing sandbox isolation, resource limits, scan checks and two-jobs-per-incident limit apply. The executable fixture and UI preset are verified to match.

## Mobile capture

The existing `deviceops-mobile` app now has an **Evidence** tab. Sign in, select an operational incident, then choose **Take rack photo** or **Choose photo**. Camera permission is requested explicitly. Picker JPEG bytes are checked against the 10 MB limit, hashed with Expo Crypto and sent to the existing tenant-scoped artifact API. The preview on the phone is labeled local/unprocessed. Server processing status is refreshed while the screen is focused. Device association can only be confirmed after clean processing, and only for devices belonging to the incident.

The old New Run camera shortcut now opens Evidence instead of claiming a photo was attached while sending an empty media list. Existing run and incident flows remain available. The new photo flow does not approve remediation.

For a physical phone, `EXPO_PUBLIC_DEVICEOPS_API_URL` must point to a backend address reachable from the phone; phone `localhost` does not refer to the workstation. Use HTTPS for a hosted deployment. Camera/crypto permissions and native module changes require a compatible new development/preview build or matching Expo Go environment.

### Verification boundaries for mobile

- **Automated contract verification:** Unit and integration checks (`npm run test:evidence` in mobile, `scripts/acoustic-mobile-integration.mts`) verify byte decoding, SHA-256 crypto hashing, ClamAV quarantine/scanning, tenant isolation, and API payload contracts using synthetic JPEG buffers. They do *not* execute on mobile hardware or capture camera frames.
- **Build verification:** Running `./build-apk.sh` in the mobile repo compiles, aligns, and signs `build/deviceops-preview.apk` embedding `http://127.0.0.1:3030`.
- **Physical-phone capture/upload:** Testing with a physical Android handset is an attached-device runtime procedure requiring USB debugging (`adb reverse tcp:3030 tcp:3030`), interactive OS camera permissions, and real-time capture. Physical hardware capture and upload is not established by headless unit tests or an APK build alone. This runtime procedure was executed and verified on an attached physical Android handset (`MVLZHQQOPJM7LFBI`, September 14, 2026): real camera capture of rack equipment, client-side SHA-256 hashing, reverse-tunnel upload to `/api/v2/artifacts`, containerized ClamAV scan (`scan: clean`), and technician device association confirmation (`Auditorium Dual Projector`).

## Real scanning

Camera/gallery processing re-encodes images, so their checksums will not match a synthetic-fixture allowlist. Use the optional `compose.media-scan.yaml` overlay to scan real uploads with private ClamAV:

```sh
docker compose --env-file .env.demo -f compose.demo.yaml -f compose.enterprise.yaml -f compose.media-scan.yaml up -d
```

The scanner port is not published; definitions persist in a Docker volume. The image is pinned to the digest verified for this release, and it has a 4 GiB local memory limit. Plan hosted resource costs separately before enabling this overlay on AWS. The configuration follows the [official ClamAV Docker guidance](https://docs.clamav.net/manual/Installing/Docker.html). An unavailable or failed scan never admits a photo to model input.

Reproduction checks: `scripts/acoustic-check.mts`, `scripts/scanner-check.mts`, `scripts/acoustic-mobile-integration.mts`, and mobile `src/incident-evidence.test.ts`. The integration check imports the photo-payload helper from the sibling mobile repository and uses a generated JPEG with real scanning; it does not emulate a hardware camera.


The Android preview profile explicitly embeds `http://127.0.0.1:3030`. Run the sibling mobile repository's `./build-apk.sh`; it validates the signed candidate APK before replacing the previous preview. On the connected phone, use Windows `adb reverse tcp:3030 tcp:3030`. The previous APK was found to contain the old port 3000 and must not be described as corrected until the artifact check passes.

For the acoustic UI, load the preset **before** selecting the waveform CSV: loading a preset clears prior selections. This avoids accidentally analyzing unrelated input.
