output "d1_database_id" {
  value = cloudflare_d1_database.db.id
}

output "preview_d1_database_id" {
  value = cloudflare_d1_database.preview_db.id
}

output "pages_project_name" {
  value = cloudflare_pages_project.site.name
}
