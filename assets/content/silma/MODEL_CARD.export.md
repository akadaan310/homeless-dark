# silma-tts-v1

ONNX export of [**SILMA TTS v1**](https://huggingface.co/silma-ai/silma-tts)
(`silma-ai/silma-tts`) for [phoonnx](https://github.com/TigreGotico/phoonnx)'s
`F5TTSAdapter` (`engine: "f5tts"`).

SILMA TTS v1 is a bilingual **Arabic (MSA/Fusha, full tashkeel support) +
English** 150M-parameter flow-matching DiT (F5-TTS architecture, `dim=768`,
`depth=18`, `heads=12`) pretrained from scratch by [SILMA AI](https://silma.ai).

Exported with [DakeQQ/F5-TTS-ONNX](https://github.com/DakeQQ/F5-TTS-ONNX) into
three graphs:

| File | Role |
|---|---|
| `model.onnx` | DiT transformer (one Euler ODE step per call, NFE loop) |
| `F5_Preprocess.onnx` | reference audio + text ids → noise, rope, cat_mel_text |
| `F5_Decode.onnx` | denoised mel → waveform (Vocos + ISTFT baked in) |

Voice cloning is in-context: provide a short (<8 s) 24 kHz reference clip and
its transcription.

phoonnx catalog ids: `silma/v1` (Arabic) and `silma/v1-en` (English) — both
resolve to these files.

## License

**Apache-2.0** — upstream weights `silma-ai/silma-tts` are Apache-2.0
(commercial use allowed); this ONNX conversion inherits that license.
