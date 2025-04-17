//MqttClientTracker.js
const express = require('express');
const { Gauge, Registry } = require('prom-client');
const { exec } = require('child_process');

// This class tracks the number of connected MQTT clients and exposes the data via a Prometheus metrics endpoint.
class MqttClientTracker {
  constructor() {
    this.podName = process.env.POD_NAME || 'unknown_pod';
    this.nodeIp = process.env.NODE_IP || 'unknown_node';
    this.port = parseInt(process.env.METRICS_PORT || '3008', 10);
    this.mqttHost = process.env.MQTT_HOST || '127.0.0.1';
    this.mqttPort = process.env.MQTT_PORT || '1885';
    this.interval = parseInt(process.env.INTERVAL_MS || '2000', 10);
    
    try {
      // Parse CUSTOM_LABELS from environment variable
      this.customLabels = JSON.parse(process.env.CUSTOM_LABELS || '{}');
    } catch (err) {
      console.warn('Invalid CUSTOM_LABELS, should be valid JSON:', err);
      this.customLabels = {};
    }
    // initialize the registry and the gauge
    this.registry = new Registry();
    this.lastClientCount = 0;

    // Create a Gauge metric to track the number of connected clients
    const labelNames = ['pod', 'node', 'mqtthost' ,...Object.keys(this.customLabels)];

    this.clientCountGauge = new Gauge({
      name: 'mqtt_connected_clients',
      help: 'Number of connected MQTT clients',
      labelNames,
      registers: [this.registry],
    });

    this.app = express();

    // Set up the /metrics endpoint to expose the metrics
    this.app.get('/metrics', async (req, res) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(await this.registry.metrics());
    });
  }
  // Start the HTTP server and the interval to update the client count
  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`✅ MqttClientTracker running on port ${this.port}`);
    });
    this.intervalHandle = setInterval(() => this.updateClientCount(), this.interval);
  }
  // Stop the HTTP server and clear the interval
  stop() {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    if (this.server) this.server.close();
    console.log(`🛑 Tracker stopped.`);
  }
  // Update the client count by executing a shell command to get the number of established connections
  updateClientCount() {
    const cmd = `netstat -ant | grep ESTABLISHED | grep '${this.mqttHost}:${this.mqttPort}' | wc -l`;
    exec(cmd, (error, stdout, stderr) => {
      if (error || stderr) {
        console.error(`Failed to get client count: ${error || stderr}`);
        return;
      }

      const count = parseInt(stdout.trim(), 10) / 2; 
      this.lastClientCount = count;

      const labels = {
        pod: this.podName,
        node: this.nodeIp,
        mqtthost: this.mqttHost,
        ...this.customLabels,
      };

      this.clientCountGauge.labels(labels).set(count);
      console.log(`[${this.podName} | ${this.nodeIp}] Updated client count: ${count}`);
    });
  }
}

module.exports = MqttClientTracker;


//index.js
const MqttClientTracker = require("./MqttClientTracker");

// Initialize the MqttClientTracker class and start the server
const tracker = new MqttClientTracker();
tracker.start();

process.on('SIGINT', () => tracker.stop());
process.on('SIGTERM', () => tracker.stop());


