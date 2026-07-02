variable "aws_region" {
  description = "AWS region (must match the core stack)"
  type        = string
}

variable "state_bucket" {
  description = "S3 bucket holding terraform state — the same bucket core uses"
  type        = string
}

variable "state_region" {
  description = "Region of the state bucket; empty means aws_region"
  type        = string
  default     = ""
}

variable "core_state_key" {
  description = "State key of the core stack"
  type        = string
  default     = "core/terraform.tfstate"
}

variable "env_name" {
  description = "Environment name; empty means the current terraform workspace"
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Hosted zone for <env>.<base_domain> records; null inherits core's zone, empty string skips DNS"
  type        = string
  default     = null
  nullable    = true
}

# Provider-only overrides for stamping through the SSM tunnel
# (scripts/db-tunnel.sh + --via-tunnel). The environment's stored DATABASE_URL
# always keeps the real in-VPC RDS host.
variable "database_host_override" {
  description = "Host the postgresql provider connects to; empty uses the RDS address"
  type        = string
  default     = ""
}

variable "database_port_override" {
  description = "Port the postgresql provider connects to; 0 uses the RDS port"
  type        = number
  default     = 0
}

variable "web_image_tag" {
  description = "Tag in the shared web ECR repository this environment runs"
  type        = string
  default     = "latest"
}

variable "web_desired_count" {
  type    = number
  default = 1
}

variable "web_cpu" {
  type    = number
  default = 1024
}

variable "web_memory" {
  type    = number
  default = 2048
}

variable "ai_default_provider" {
  description = "anthropic | openai | mistral | bedrock"
  type        = string
  default     = "anthropic"
}

variable "enable_semchunk" {
  description = "Deploy this environment's semantic-chunking sidecar (ADR-030)"
  type        = bool
  default     = false
}

variable "semchunk_image_tag" {
  description = "Tag in the shared semchunk ECR repository"
  type        = string
  default     = "latest"
}

variable "semchunk_cpu" {
  type    = number
  default = 256
}

variable "semchunk_memory" {
  type    = number
  default = 512
}
