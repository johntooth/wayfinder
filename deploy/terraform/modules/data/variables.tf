variable "name" { type = string }

variable "subnet_ids" { type = list(string) }

variable "database_security_group_id" { type = string }

# wayfinder's guides and its pgvector image are on 16.
variable "postgres_version" {
  type    = string
  default = "16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_storage_gb" {
  type    = number
  default = 20
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "secrets_version" {
  description = "Bump to generate and write a new database password."
  type        = number
  default     = 1
}
