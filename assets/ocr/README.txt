PP-OCRv5 mobile OCR assets

Files:
- PP-OCRv5_mobile_det_infer.onnx
- PP-OCRv5_mobile_rec_infer.onnx
- ppocrv5_dict.txt

Source:
https://huggingface.co/x3zvawq/paddleocr-js-onnx/tree/main/ppocr_v5_mobile

The models are converted from PaddleOCR / PaddleX (Apache-2.0).
The local inference runtime is provided by:
- paddleocr (MIT)
- onnxruntime-node (MIT)

The dictionary file starts with a CTC blank entry. PP-OCRv5 mobile expects one
extra output class; the loader keeps or appends the trailing blank entry.
