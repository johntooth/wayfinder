variable "project_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "web_security_group_id" {
  type = string
}

variable "certificate_arn" {
  type = string
}

variable "public_url" {
  type = string
}

variable "web_image_tag" {
  type = string
}

variable "web_desired_count" {
  type = number
}

variable "web_cpu" {
  type = number
}

variable "web_memory" {
  type = number
}

variable "ai_default_provider" {
  type = string
}

variable "database_url_secret_arn" {
  type = string
}

variable "documents_bucket" {
  type = string
}

variable "storage_access_key_secret_arn" {
  type = string
}

variable "storage_secret_key_secret_arn" {
  type = string
}

variable "semchunk_enabled" {
  type = bool
}

variable "semchunk_url" {
  type = string
}
