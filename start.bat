@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
echo.
echo ================================================
echo VisionIngest - Document Extraction with DeepSeek-OCR-2 + LLM
echo ================================================
echo.
echo IMPORTANT: Make sure Ollama is installed and running!
echo   1. Install: winget install Ollama.Ollama
echo   2. Pull model: ollama pull gpt-oss
echo   3. See OLLAMA_SETUP.md for details
echo.
echo Press Ctrl+C to exit, or any key to continue...
pause >nul
echo.

REM Check if uv is installed
where uv >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto INSTALL_UV
goto CHECK_VENV

:INSTALL_UV
echo [1/2] Installing uv (fast package manager)...
pip install uv
if %ERRORLEVEL% NEQ 0 goto ERROR_UV
goto CHECK_VENV

:ERROR_UV
echo [ERROR] Failed to install uv. Please install pip first.
pause
exit /b 1

:CHECK_VENV
REM Check if virtual environment exists
if exist "env\Scripts\activate.bat" goto ACTIVATE_VENV
goto CREATE_VENV

:CREATE_VENV
echo.
echo ================================================
echo First Time Setup
echo ================================================
echo.

echo [2/6] Creating virtual environment...
uv venv env
if %ERRORLEVEL% NEQ 0 goto ERROR_VENV

echo [3/6] Activating environment...
call env\Scripts\activate.bat

echo [4/6] Installing PyTorch with CUDA 12.8...
uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
if %ERRORLEVEL% NEQ 0 goto TRY_CPU_TORCH

:AFTER_TORCH
echo [5/6] Installing Python dependencies...
uv pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 goto ERROR_REQUIREMENTS

echo [6/6] Installing frontend dependencies...
cd frontend
call npm install
if %ERRORLEVEL% NEQ 0 goto ERROR_NPM
cd ..

echo.
echo ================================================
echo Setup Complete!
echo ================================================
echo.
goto START_SERVICES

:TRY_CPU_TORCH
echo [WARNING] CUDA 12.8 failed, trying CPU version...
uv pip install torch torchvision torchaudio
goto AFTER_TORCH

:ERROR_VENV
echo [ERROR] Failed to create virtual environment
pause
exit /b 1

:ERROR_REQUIREMENTS
echo [ERROR] Failed to install requirements
pause
exit /b 1

:ERROR_NPM
echo [ERROR] Failed to install npm packages
cd ..
pause
exit /b 1

:ACTIVATE_VENV
call env\Scripts\activate.bat

REM Update dependencies if requirements.txt changed
echo [INFO] Checking for dependency updates...
uv pip install -r requirements.txt --quiet
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Failed to update dependencies
)

goto START_SERVICES

:START_SERVICES
echo.
echo [INFO] Checking GPU...
python -c "import torch; print(f'CUDA: {torch.cuda.is_available()}'); print(f'Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"CPU\"}')" 2>nul
echo.

echo [INFO] Starting all services in parallel...

REM Start backend
cd backend
start "VisionIngest - Backend" cmd /k "uvicorn main:app --reload --host 0.0.0.0 --port 8000"
cd ..

REM Start frontend
if exist "frontend\package.json" (
    cd frontend
    start "VisionIngest - Frontend" cmd /k "npm run dev"
    cd ..
)

REM Brief wait for Vite to start, then open browser
timeout /t 4 /nobreak >nul
echo [INFO] Opening browser (backend still loading in background)...
start http://localhost:5173

echo.
echo ================================================
echo Services Started!
echo ================================================
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo API Docs: http://localhost:8000/docs
echo.
echo Close this window to keep services running.
echo Press any key to exit...
pause >nul
