# ASL inference improvement log

## Scope and constraints

- The deployed `asl-landmark-model.json` weights, architecture, and 42-value feature definition were not changed.
- No retraining or augmentation was performed.
- All changes are inference-side preprocessing, temporal stabilization, camera configuration, and confidence post-processing.

## Stage 1: feature-contract audit

The training script and validation data were absent. The model JSON therefore served as the available contract: 21 normalized MediaPipe landmarks in index order, wrist (0) origin, x/y only, and `max(abs(dx), abs(dy))` normalization into 42 float values. Main and tutorial now use one shared preprocessing/model implementation. The legacy `webcam-input.js` TFLite path is not referenced by any page and was excluded from evaluation.

Result: preprocessing unit tests passed; real confusion matrix, per-class accuracy, and top-five confusion pairs are pending an independent labelled validation manifest.

## Stage 2: temporal stabilization

Pipeline order is now raw landmark -> One Euro (or optional EMA) filter -> unchanged 42D feature -> model -> probability EMA -> 7-frame vote -> 0.85 entry / 0.70 exit hysteresis -> 300 ms debounce. Filtering occurs before feature extraction, so the feature definition remains unchanged.

Default parameters: One Euro min cutoff 1.0, beta 0.02, derivative cutoff 1.0; landmark and probability EMA alpha 0.35. Jitter reduction is not claimed until webcam sequences are measured.

## Stage 3: camera and MediaPipe

Both active inference paths use `VIDEO` and `detectForVideo(video, timestamp)`, one hand, and GPU delegate. Camera requests prefer 1280x720 at 30 fps. Detection, presence, and tracking confidence are currently 0.70 candidates, raised from 0.60. They require repeated 0.60-versus-0.70 webcam detection-rate runs before being treated as a final choice.

## Stage 4: calibrated confidence and rejection

Temperature scaling operates on logits before softmax. Top-2 margin (default 0.15), optional class-specific thresholds, and optional energy OOD rejection affect only confirmation, never model weights. Calibration artifacts start deliberately uncalibrated (`T=1`, OOD disabled), because no independent validation/OOD data was supplied.

## Verification record

- Automated tests: 11 passed, 0 failed.
- Syntax and whitespace diff checks passed.
- `assets/models/asl-landmark-model.json` was not modified.
- No real-world accuracy, confusion, flicker, detection-rate, temperature, or OOD metrics are available yet. Synthetic fixtures were smoke tests only and must not be quoted as model performance.

## Reproducible experiment commands

From the repository root:

```powershell
npm test
node experiments/tools/evaluate-landmarks.mjs C:\asl-data\validation-webcam-v1.json --out reports\validation-webcam-v1
node experiments/tools/measure-stability.mjs C:\asl-data\validation-webcam-v1.json --out reports\stability-webcam-v1
node experiments/tools/calibrate-confidence.mjs C:\asl-data\validation-webcam-v1.json
```

Use `experiments/tools/capture-landmark-samples.html` to create labelled frame/sequence manifests and `experiments/tools/measure-hand-detection.html` to compare the 0.60 and 0.70 MediaPipe settings.

## Future work requiring retraining

1. Add z/world coordinates, joint angles, orientation, or other new features.
2. Change normalization to palm-size, rotational, or Procrustes normalization.
3. Canonicalize left/right hands only after establishing the training convention.
4. Train with additional diverse labelled samples and augmentation.
5. Use a temporal classifier for motion letters J and Z.
6. Train an explicit unknown class or learned feature-space OOD model.
