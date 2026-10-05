variable "prefix" {
  type        = string
  description = "Resource name prefix, e.g. skilltrack."
  default     = "skilltrack"
}

variable "environment" {
  type        = string
  description = "dev | staging | prod."
}

variable "location" {
  type        = string
  description = "Azure region for every resource in this template."
  default     = "westeurope"
}

variable "vnet_address_space" {
  type        = string
  description = "Address space of the lab virtual network."
  default     = "10.40.0.0/16"
}

variable "lab_subnet_prefix" {
  type        = string
  description = "Subnet for lab VMs. VMs here must have no public IP."
  default     = "10.40.1.0/24"
}

variable "gateway_subnet_prefix" {
  type        = string
  description = "Subnet hosting the Guacamole gateway; the only source allowed to reach RDP."
  default     = "10.40.2.0/27"
}

variable "app_principal_id" {
  type        = string
  description = "Object id of an existing app managed identity. Null creates one here."
  default     = null
}

variable "tags" {
  type        = map(string)
  description = "Additional cost/ownership tags."
  default     = {}
}
