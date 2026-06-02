# Troubleshooting

## "DLL load failed while importing _greenlet"

On Windows, if the accessibility check fails with:

```
Error: DLL load failed while importing _greenlet: The specified module could not be found.
```

the **Playwright** dependency `greenlet` cannot load because the **Microsoft Visual C++ Redistributable** is missing or not matching.

### Fix

1. **Install the Microsoft Visual C++ Redistributable** (one-time):
   - Open: [Latest supported Visual C++ downloads](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)
   - Download and run **VC++ Redistributable for Visual Studio 2022** (or latest), **x64** version.
   - Or direct link (x64): https://aka.ms/vs/17/release/vc_redist.x64.exe
   - Install it, then restart your terminal (or reboot if needed).

2. **Install Playwright’s Chromium** (from the project folder):
   ```bash
   cd UI_Design
   python -m playwright install chromium
   ```

3. **Run the app again**:
   ```bash
   python app.py
   ```
   Then use **Process** on a URL; screenshots should work.

### If it still fails

- Ensure you’re using the same Python (e.g. `python --version`) when running `app.py` and when you ran `pip install -r requirements.txt`.
- Try a **virtual environment** with a clean install:
  ```bash
  source env/bin/activate
  pip install -r requirements.txt
  python -m playwright install chromium
  python app.py
  ```
