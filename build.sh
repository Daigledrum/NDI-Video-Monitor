#!/bin/bash
# Build script for NDI Video Monitor
# Compiles native binaries and builds Electron app

set -e  # Exit on error

echo "🔨 Building NDI Video Monitor..."
echo ""

# Detect platform
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="mac"
    NDI_SDK_PATH="/Library/NDI SDK for Apple"
    NDI_LIB_PATH="$NDI_SDK_PATH/lib/macOS"
    NDI_INCLUDE_PATH="$NDI_SDK_PATH/include"
    BINARY_EXTENSION=""
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    PLATFORM="win"
    NDI_SDK_PATH="C:/Program Files/NDI/NDI 5 SDK"
    NDI_LIB_PATH="$NDI_SDK_PATH/lib/x64"
    NDI_INCLUDE_PATH="$NDI_SDK_PATH/include"
    BINARY_EXTENSION=".exe"
else
    PLATFORM="linux"
    NDI_SDK_PATH="/opt/ndi"
    NDI_LIB_PATH="$NDI_SDK_PATH/lib/x86_64-linux-gnu"
    NDI_INCLUDE_PATH="$NDI_SDK_PATH/include"
    BINARY_EXTENSION=""
fi

echo "📍 Platform detected: $PLATFORM"
echo ""

# Step 1: Compile NDI binaries
echo "📦 Step 1/3: Compiling NDI binaries..."

if [ "$PLATFORM" == "mac" ]; then
    gcc -o ndi_recv ndi_recv.c \
      -L"$NDI_LIB_PATH" \
      -lndi \
      -I"$NDI_INCLUDE_PATH" \
      -Wl,-rpath,"$NDI_LIB_PATH"
    
    gcc -o ndi_list ndi_list.c \
      -L"$NDI_LIB_PATH" \
      -lndi \
      -I"$NDI_INCLUDE_PATH" \
      -Wl,-rpath,"$NDI_LIB_PATH"
elif [ "$PLATFORM" == "win" ]; then
    cl /Fe:ndi_recv.exe ndi_recv.c \
      /I"$NDI_INCLUDE_PATH" \
      /link /LIBPATH:"$NDI_LIB_PATH" Processing.NDI.Lib.x64.lib
    
    cl /Fe:ndi_list.exe ndi_list.c \
      /I"$NDI_INCLUDE_PATH" \
      /link /LIBPATH:"$NDI_LIB_PATH" Processing.NDI.Lib.x64.lib
else
    gcc -o ndi_recv ndi_recv.c \
      -L"$NDI_LIB_PATH" \
      -lndi \
      -I"$NDI_INCLUDE_PATH" \
      -Wl,-rpath,"$NDI_LIB_PATH"
    
    gcc -o ndi_list ndi_list.c \
      -L"$NDI_LIB_PATH" \
      -lndi \
      -I"$NDI_INCLUDE_PATH" \
      -Wl,-rpath,"$NDI_LIB_PATH"
fi

echo "✅ Binaries compiled: ndi_recv$BINARY_EXTENSION, ndi_list$BINARY_EXTENSION"
echo ""

# Step 2: Install dependencies
echo "📦 Step 2/3: Installing Node.js dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Step 3: Build Electron app
echo "📦 Step 3/3: Building Electron application..."
if [ "$PLATFORM" == "mac" ]; then
    npm run build-mac
elif [ "$PLATFORM" == "win" ]; then
    npm run build-win
else
    npm run build
fi

echo ""
echo "✅ Build complete!"
echo "📁 Output files are in the 'dist/' folder"
echo ""
echo "🚀 To test the app, run: npm start"
