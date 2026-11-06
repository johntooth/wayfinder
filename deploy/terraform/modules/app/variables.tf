variable "name" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "alb_security_group_id" { type = string }
variable "web_security_group_id" { type = string }
variable "api_security_group_id" { type = string }
variable "access_log_bucket" { type = string }
variable "cloudfront_log_bucket_domain_name" { type = string }
variable "web_acl_arn" { type = string }
variable "database_url_secret_arn" { type = string }
variable "documents_bucket" { type = string }

variable "storage_key_secret_arn" {
  description = "JSON secret with access_key_id and secret_access_key for the storage user."
  type        = string
}

variable "bedrock_key_secret_arn" {
  description = "JSON secret with access_key_id and secret_access_key for the Bedrock user."
  type        = string
}

variable "image" {
  description = "The wayfinder image pinned by digest, built with VENDOR_EMBEDDINGS_MODEL=true (remote model downloads are off)."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "Pin the image by digest."
  }
}

variable "bedrock_region" { type = string }

variable "admin_seed_email" {
  description = "Only this address may create the first admin on /setup."
  type        = string
}

variable "web_port" {
  type    = number
  default = 3000
}

variable "api_port" {
  type    = number
  default = 3001
}

variable "web_cpu" {
  type    = number
  default = 1024
}

variable "web_memory" {
  type    = number
  default = 2048
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "web_desired_count" {
  type    = number
  default = 1
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "database_pool_max" {
  description = "Per process. Keep this times the task count under the instance's max_connections."
  type        = number
  default     = 10
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "secrets_version" {
  description = "Bump to generate and write new values for the generated secrets. Rotating settings-encryption-key makes stored integration credentials unreadable; better-auth-secret signs everyone out."
  type        = number
  default     = 1
}

variable "run_migrations" {
  description = "Run the migrate task before web and api roll out whenever its task definition changes. Off only for offline tests."
  type        = bool
  default     = true
}
