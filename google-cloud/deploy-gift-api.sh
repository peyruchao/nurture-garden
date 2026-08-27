#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: bash google-cloud/deploy-gift-api.sh PROJECT_ID [VIVERSE_ORIGIN]"
  exit 1
fi

project_id="$1"
allowed_origin="${2:-*}"
region="us-central1"
bucket_name="${project_id}-nurture-gifts"
service_account_name="nurture-gift-api"
service_account_email="${service_account_name}@${project_id}.iam.gserviceaccount.com"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

gcloud config set project "$project_id"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com

if ! gcloud iam service-accounts describe "$service_account_email" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$service_account_name" \
    --display-name="Nurture Garden Gift API"
fi

gcloud projects add-iam-policy-binding "$project_id" \
  --member="serviceAccount:${service_account_email}" \
  --role="roles/datastore.user" \
  --quiet

if ! gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database="(default)" \
    --location="$region" \
    --type=firestore-native
fi

if ! gcloud storage buckets describe "gs://${bucket_name}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${bucket_name}" \
    --location="$region" \
    --uniform-bucket-level-access
fi

gcloud storage buckets add-iam-policy-binding "gs://${bucket_name}" \
  --member="serviceAccount:${service_account_email}" \
  --role="roles/storage.objectAdmin"

gcloud run deploy nurture-gift-api \
  --source "${script_dir}/gift-api" \
  --region "$region" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --memory=512Mi \
  --concurrency=20 \
  --service-account "$service_account_email" \
  --set-env-vars="GIFT_BUCKET=${bucket_name},ALLOWED_ORIGINS=${allowed_origin}"

service_url="$(gcloud run services describe nurture-gift-api \
  --region "$region" \
  --format='value(status.url)')"

echo
echo "Gift API deployed: ${service_url}"
echo "Add this to .env.local:"
echo "VITE_GIFT_API_BASE=${service_url}"
