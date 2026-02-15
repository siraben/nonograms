terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  # Set CLOUDFLARE_API_TOKEN in your environment.
}

resource "cloudflare_d1_database" "db" {
  account_id = var.cloudflare_account_id
  name       = var.d1_database_name
}

resource "cloudflare_pages_project" "site" {
  account_id        = var.cloudflare_account_id
  name              = var.pages_project_name
  production_branch = var.production_branch

  deployment_configs = {
    production = {
      d1_databases = {
        DB = { id = cloudflare_d1_database.db.id }
      }
    }
    preview = {
      d1_databases = {
        DB = { id = cloudflare_d1_database.db.id }
      }
    }
  }
}

