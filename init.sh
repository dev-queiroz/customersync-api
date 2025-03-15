#!/bin/bash
aws --endpoint-url=http://localhost:4566 s3 mb s3://pedidos-processados
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name fila-pedidos
aws --endpoint-url=http://localhost:4566 logs create-log-group --log-group-name pedidos-logs
aws --endpoint-url=http://localhost:4566 logs create-log-stream --log-group-name pedidos-logs --log-stream-name stream1
aws --endpoint-url=http://localhost:4566 dynamodb create-table --table-name pedidos --attribute-definitions AttributeName=PedidoId,AttributeType=S --key-schema AttributeName=PedidoId,KeyType=HASH --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5
aws --endpoint-url=http://localhost:4566 sns create-topic --name pedidos-concluidos