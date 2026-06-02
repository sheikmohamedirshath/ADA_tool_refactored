# Deploy to Azure App Service

The backend is a **Flask** app (`app.py`). In production we run it with **Gunicorn** (a WSGI server), not Flask’s built-in server—that’s the standard way to run Flask on Azure. The app (Flask + React + Playwright ADA check) can be deployed in two ways. **Option 1 (Docker)** is recommended because it includes Chromium for Playwright with no extra setup.

---

## Option 1: Deploy as a container (recommended)

The repo includes a **Dockerfile** that builds the React UI and runs the Flask app with Playwright/Chromium in one image. Use **Web App for Containers**.

### Prerequisites

- **Azure CLI** ([install](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli))
- **Docker** (to build and push the image), or use **Azure Container Registry (ACR)** with a cloud build
- **Azure subscription**

### 1. Build and push the Docker image

**Option A: Build locally and push to Azure Container Registry**

```bash
# Login to Azure
az login

# Create a resource group and ACR (one-time)
az group create --name rg-ui-design --location eastus
az acr create --resource-group rg-ui-design --name youracrname --sku Basic

# Build the image (from project root)
docker build -t youracrname.azurecr.io/ui-design:latest .

# Push to ACR (login first)
az acr login --name youracrname
docker push youracrname.azurecr.io/ui-design:latest
```

**Option B: Use ACR with GitHub Actions / cloud build**

- In Azure Portal: create **Container Registry** and **App Service** (Linux, Docker).
- Under App Service → **Deployment Center**, connect your repo and choose **Azure Container Registry** as source; Azure can build the image from the Dockerfile when you push.

### 2. Create the App Service (Docker)

```bash
# Create App Service plan and web app (Linux, Docker)
az appservice plan create --resource-group rg-ui-design --name plan-ui-design --is-linux
az webapp create --resource-group rg-ui-design --plan plan-ui-design --name your-app-name \
  --deployment-container-image-name youracrname.azurecr.io/ui-design:latest

# If using private ACR, set credentials
az webapp config container set --resource-group rg-ui-design --name your-app-name \
  --docker-custom-image-name youracrname.azurecr.io/ui-design:latest \
  --docker-registry-server-url https://youracrname.azurecr.io \
  --docker-registry-server-user <acr-username> \
  --docker-registry-server-password <acr-password>
```

### 3. Configure the app

- **Port:** App Service expects the container to listen on the port given by `PORT` (often 8000). The Dockerfile already uses `gunicorn --bind 0.0.0.0:${PORT}`.
- In Azure Portal: **App Service** → **Configuration** → **Application settings** → add `WEBSITES_PORT` = `8000` if your container uses 8000 (our Dockerfile sets `ENV PORT=8000`; Azure usually passes `PORT` automatically).
- **Always On** (optional): Under **Configuration** → **General settings**, enable **Always On** so the app doesn’t sleep on the free tier (if applicable).

### 4. Open the app

- URL: `https://your-app-name.azurewebsites.net`
- Use **Home** to enter a URL and click **Process**; the ADA check runs in the container with Playwright/Chromium.

---

## Option 2: Deploy as a Python app (zip or Git)

You can deploy **without Docker** by building the React app first and deploying the project as a **Python** app. Playwright/Chromium must be installed at startup (slower cold start) or via a custom runtime.

### 1. Build the React app locally

```bash
npm ci
npm run build
```

Keep the **dist/** folder; you will deploy it with the rest of the app.

### 2. Prepare the deployment package

- Include: `app.py`, `requirements.txt`, `services/`, `scripts/`, `sample_result_file/`, **dist/** (built in step 1).
- Exclude: `node_modules/`, `.venv/`, `env/`, `.git/`, etc.

### 3. Create the App Service (Python)

```bash
az appservice plan create --resource-group rg-ui-design --name plan-ui-design --is-linux --sku B1
az webapp create --resource-group rg-ui-design --plan plan-ui-design --name your-app-name --runtime "PYTHON:3.11"
```

### 4. Startup command (install Chromium + run app)

Playwright needs Chromium. Use a startup command that installs it then starts Gunicorn (longer first start):

In **Azure Portal** → **App Service** → **Configuration** → **General settings** → **Startup Command**:

```bash
pip install playwright && playwright install --with-deps chromium && gunicorn --bind=0.0.0.0:8000 --timeout 600 --workers 1 app:app
```

Or use a **startup script** (e.g. `startup.sh`) that does the same and set that as the startup command. For production, **Option 1 (Docker)** is more reliable because Chromium is already in the image.

### 5. Deploy the code

**Zip deploy:**

```bash
# From project root (with dist/ present)
zip -r deploy.zip app.py requirements.txt services scripts sample_result_file dist
az webapp deploy --resource-group rg-ui-design --name your-app-name --src-path deploy.zip --type zip
```

**Git deploy:** Push your repo and in **Deployment Center** connect GitHub/Azure Repos; ensure `dist/` is committed or built in CI (e.g. GitHub Actions runs `npm run build` and deploys).

---

## Summary

| Method              | Pros                                      | Cons                               |
|---------------------|-------------------------------------------|------------------------------------|
| **Docker (Option 1)** | Chromium included, predictable, no startup install | Requires container registry / Docker build |
| **Python + zip/Git (Option 2)** | No Docker needed, uses Azure Python runtime | Chromium install at startup; slower and more fragile |

**Recommendation:** Use **Option 1 (Docker)** so the ADA check (Playwright + Chromium) runs reliably on Azure App Service.

---

## Troubleshooting

- **App not loading / 503:** Ensure the container listens on `0.0.0.0` and the port Azure provides (`PORT` or 8000). The provided Dockerfile does this.
- **ADA check fails in cloud:** In Docker, ensure the base image is Playwright’s (e.g. `mcr.microsoft.com/playwright/python:v1.50.0-noble`) so Chromium and dependencies are present. For Option 2, ensure the startup command actually runs `playwright install --with-deps chromium`.
- **Timeout on Process:** ADA can take 1–2 minutes. The Dockerfile uses `gunicorn --timeout 600`. In Azure **Configuration** → **General settings**, increase **Request time-out** if needed (e.g. 230 seconds or more).
