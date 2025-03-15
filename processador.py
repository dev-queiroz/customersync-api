import boto3
import json
import time
from datetime import datetime

# Configuração do cliente LocalStack
ENDPOINT_URL = "http://localhost:4566"
s3 = boto3.client("s3", endpoint_url=ENDPOINT_URL, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1")
sqs = boto3.client("sqs", endpoint_url=ENDPOINT_URL, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1")
dynamodb = boto3.resource("dynamodb", endpoint_url=ENDPOINT_URL, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1")
logs = boto3.client("logs", endpoint_url=ENDPOINT_URL, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1")
sns = boto3.client("sns", endpoint_url=ENDPOINT_URL, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1")

# Recursos
QUEUE_URL = sqs.get_queue_url(QueueName="fila-pedidos")["QueueUrl"]
TABLE = dynamodb.Table("pedidos")
TOPIC_ARN = sns.create_topic(Name="pedidos-concluidos")["TopicArn"]

# Enviar um pedido para a fila
def enviar_pedido():
    pedido = {"PedidoId": f"pedido-{int(time.time())}", "Produto": "Camiseta", "Quantidade": 2}
    sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps(pedido))
    print(f"Pedido enviado: {pedido}")

# Processar pedidos da fila
def processar_pedidos():
    while True:
        response = sqs.receive_message(QueueUrl=QUEUE_URL, MaxNumberOfMessages=1)
        if "Messages" in response:
            msg = response["Messages"][0]
            pedido = json.loads(msg["Body"])
            receipt_handle = msg["ReceiptHandle"]

            # Salvar no S3
            s3.put_object(Bucket="pedidos-processados", Key=f"{pedido['PedidoId']}.json", Body=json.dumps(pedido))

            # Salvar no DynamoDB
            TABLE.put_item(Item=pedido)

            # Enviar log ao CloudWatch
            logs.put_log_events(
                logGroupName="pedidos-logs",
                logStreamName="stream1",
                logEvents=[{"timestamp": int(time.time() * 1000), "message": f"Processado: {pedido['PedidoId']}"}]
            )

            # Enviar notificação SNS
            sns.publish(TopicArn=TOPIC_ARN, Message=f"Pedido {pedido['PedidoId']} concluído!")

            # Remover mensagem da fila
            sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
            print(f"Processado: {pedido['PedidoId']}")
        time.sleep(1)

if __name__ == "__main__":
    enviar_pedido()  # Envia um pedido de exemplo
    processar_pedidos()  # Inicia o processamento