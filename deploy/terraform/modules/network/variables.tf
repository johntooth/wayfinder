variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "cidr" {
  description = "Distinct from the gateway's 10.20.0.0/16, so the two could be connected later."
  type        = string
  default     = "10.30.0.0/16"
}

variable "web_port" {
  type    = number
  default = 3000
}

variable "tags" {
  type    = map(string)
  default = {}
}
