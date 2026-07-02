variable "service_name" {
  description = "Unique per environment, e.g. wayfinder-tenant-a-semchunk"
  type        = string
}

variable "dns_alias" {
  description = "Service Connect DNS name, e.g. semchunk-tenant-a"
  type        = string
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

variable "execution_role_arn" {
  type = string
}

variable "image" {
  description = "Full image reference including tag"
  type        = string
}

variable "cpu" {
  type = number
}

variable "memory" {
  type = number
}

variable "client_security_group_id" {
  description = "Security group of the owning environment's web tasks"
  type        = string
}
