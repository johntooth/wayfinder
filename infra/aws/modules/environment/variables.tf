variable "project_name" {
  type = string
}

variable "env_name" {
  type = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,14}$", var.env_name))
    error_message = "env_name must be 2-15 chars, lowercase alphanumeric/hyphen, starting with a letter (ALB naming and DNS label limits)."
  }

  validation {
    condition     = var.env_name != "default"
    error_message = "env_name \"default\" is reserved — create a named terraform workspace per environment (scripts/new-environment.sh)."
  }
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "cluster_arn" {
  type = string
}

variable "namespace_arn" {
  type = string
}

variable "alb_security_group_id" {
  type = string
}

variable "alb_dns_name" {
  type = string
}

variable "alb_zone_id" {
  type = string
}

variable "https_listener_arn" {
  type = string
}

variable "base_domain" {
  description = "Environments are exposed as <env_name>.<base_domain>"
  type        = string
}

variable "route53_zone_id" {
  description = "Optional hosted zone for automatic DNS records; empty skips DNS"
  type        = string
  default     = ""
}

variable "database_host" {
  type = string
}

variable "database_port" {
  type = number
}

variable "database_security_group_id" {
  type = string
}

variable "web_image" {
  description = "Full image reference including tag"
  type        = string
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
  type    = string
  default = "anthropic"
}

variable "enable_semchunk" {
  description = "Deploy this environment's semantic-chunking sidecar (ADR-030)"
  type        = bool
  default     = false
}

variable "semchunk_image" {
  description = "Full image reference including tag (used only when enable_semchunk)"
  type        = string
  default     = ""
}

variable "semchunk_cpu" {
  type    = number
  default = 256
}

variable "semchunk_memory" {
  type    = number
  default = 512
}
