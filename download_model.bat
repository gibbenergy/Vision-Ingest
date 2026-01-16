@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
echo ================================================
echo DeepSeek-OCR-2 Model Downloader
echo ================================================
echo.
echo This will download the DeepSeek-OCR-2 model (~6GB)
echo from Hugging Face: deepseek-ai/DeepSeek-OCR-2
echo.
pause

REM Check if virtual environment exists
if not exist "env\Scripts\activate.bat" (
    echo [ERROR] Virtual environment not found!
    echo Please run start.bat first to create the environment.
    pause
    exit /b 1
)

REM Activate environment
call env\Scripts\activate.bat

REM Install huggingface-hub if needed
echo [1/3] Installing huggingface-hub...
uv pip install --python env huggingface-hub

REM Download the model
echo.
echo [2/3] Downloading DeepSeek-OCR-2 model...
echo This may take 10-20 minutes depending on your connection...
echo.
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='deepseek-ai/DeepSeek-OCR-2', local_dir='models/deepseek-ocr-2', local_dir_use_symlinks=False)"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Model download failed!
    echo Check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo [3/3] Verifying model files...
if exist "models\deepseek-ocr-2\config.json" (
    echo Model downloaded successfully!
) else (
    echo [WARNING] Model files may be incomplete.
)

echo.
echo ================================================
echo Download Complete!
echo ================================================
echo.
echo Model location: models\deepseek-ocr-2\
echo You can now run start.bat to use the application.
echo.
pause
