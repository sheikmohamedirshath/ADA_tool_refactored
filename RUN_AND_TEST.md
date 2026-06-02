# Steps to Run and Test the Project

## Prerequisites

- **Node.js** (v18 or newer)
- **Python 3.10+** (for Flask and Playwright)
- Terminal in the project folder (PowerShell/CMD on Windows, or bash in WSL)

---

## Running in WSL

You can run the same app in **WSL** (Windows Subsystem for Linux). From a WSL terminal:

```bash
cd /mnt/c/Users/UTIS LAPTOP/Downloads/UI_Design\ (2)/UI_Design   # adjust to your path

npm install
npm run build
# Activate the existing WSL-compatible Python environment
source env/bin/activate
pip install -r requirements.txt
python -m playwright install --with-deps chromium

python app.py
```

Open **http://localhost:5000** in your Windows browser; WSL2 forwards ports so it works. The Playwright ADA check runs headless Chromium inside WSL.

---

## Option 1: Flask backend (recommended)

### Step 1: Install and build

```powershell
cd C:\Users\UTIS LAPTOP\Downloads\UI_Design (2)\UI_Design

# Frontend
npm install
npm run build

# Python: activate the existing env virtual environment
env\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
```

### Step 2: Run Flask

```powershell
python app.py
```

You should see Flask start on port **5000**.

### Step 3: Open the app and test

1. Open a browser and go to: **http://localhost:5000**
2. On the **Home** page you’ll see a URL input and a **Process** button.
3. Enter a URL (e.g. `https://example.com`) and click **Process**.
4. The app will run the **Playwright + axe** ADA check and switch to **ADA Results** with the summary, violations, and passed rules.

---

## Option 2: Dev server (UI only, or UI + Flask in another terminal)

Good for frontend development: UI on port 5173, API proxied to Flask on 5000.

### Step 1: Install

```powershell
cd C:\Users\utlap\UI_Design
npm install
pip install -r requirements.txt
python -m playwright install chromium
```

### Step 2: Start the dev server

```powershell
npm run dev
```

### Step 3: (Optional) Start Flask for “Process” to work

In a **second terminal**:

```powershell
cd C:\Users\UTIS LAPTOP\Downloads\UI_Design (2)\UI_Design
env\Scripts\activate
python app.py
```

### Step 4: Test

1. Open **http://localhost:5173**
2. Enter a URL and click **Process** — the request goes to Flask on 5000 via the Vite proxy.
3. Or open **ADA Results** from the sidebar and use **Upload JSON** to load a result file.

---

## Quick reference

| What you run              | URL to open        |
|---------------------------|--------------------|
| Flask (`python app.py`)   | http://localhost:5000  |
| Dev server (`npm run dev`) | http://localhost:5173  |

---

## Troubleshooting

- **“Port already in use”**  
  Stop the other process using port 5000, or change the port in `app.py`.

- **ADA check fails or times out**  
  Ensure Playwright browsers are installed: `python -m playwright install chromium`. If the scan still fails, the error will be shown in the UI — check the Flask terminal output for the full Playwright error.

- **Screenshots missing**  
  Screenshots are only included when a live Playwright scan succeeds. If the scan fails, an error is shown instead. Check the Flask terminal for the Playwright error and ensure `python -m playwright install chromium` has been run.

- **Module not found: axe_playwright_python**  
  Run `pip install -r requirements.txt` and ensure your venv is activated.
