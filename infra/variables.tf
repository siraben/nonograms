variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare Account ID"
}

variable "pages_project_name" {
  type        = string
  description = "Cloudflare Pages project name"
  default     = "nonogram-server"
}

variable "production_branch" {
  type        = string
  description = "Git branch that Cloudflare Pages treats as production"
  default     = "main"
}

variable "d1_database_name" {
  type        = string
  description = "D1 database name"
  default     = "nonogram-db"
}

