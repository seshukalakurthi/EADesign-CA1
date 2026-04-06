# Nanoservices Checkout System in K3s
Enterprise Architecture Design CA1

Architecture:

![keda-diagram](https://github.com/user-attachments/assets/d9a9ffeb-8808-4de3-af4e-b1349696c1d2)

This system replicates a workflow for e-commerce checkout made up of several autonomous services:

Gateway – Starting point for all requests\n
Checkout – Core Service\n
Pricing – Price of the Product and tax\n
Inventory – Validates stock availability
PostgreSQL – Persistent data storage
These services are deplolyed in K3s.

Request Flow:

![keda_correlation](https://github.com/user-attachments/assets/dc94b6f6-ff7a-4f0c-a333-cb4f23dfdc16)

Each request carries an X-Request-Id header that is propagated across all services.
