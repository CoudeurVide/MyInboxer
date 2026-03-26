"use strict";
/**
 * ML Training Service
 * Implements real TensorFlow.js training with neural networks
 * Phase 1 & 2: Real ML Training + Advanced Neural Networks + Class Imbalance
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultTrainingConfig = getDefaultTrainingConfig;
exports.trainModel = trainModel;
exports.storeTrainingExample = storeTrainingExample;
exports.getTrainingStats = getTrainingStats;
// Lazy-load TF runtime to prevent native binary crash on server startup
let tf;
try {
    tf = require('@tensorflow/tfjs-node');
}
catch (e) {
    console.warn(`[ML Training] TensorFlow.js not available: ${e.message}`);
    tf = null;
}
const prisma_1 = require("../lib/prisma");
const ml_model_storage_service_1 = require("./ml-model-storage.service");
/**
 * Default training configuration
 */
function getDefaultTrainingConfig() {
    return {
        modelType: 'neural_network',
        learningRate: 0.001,
        epochs: 50,
        batchSize: 32,
        validationSplit: 0.15,
        testSplit: 0.15,
        earlyStoppingPatience: 5,
        classWeightsStrategy: 'balanced',
        dropoutRate: 0.3,
    };
}
/**
 * Calculate class weights to handle imbalance
 * Phase 2: Class Imbalance Handling
 */
function calculateClassWeights(labels, strategy) {
    if (strategy === 'none') {
        return { 0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0 };
    }
    // Count samples per class
    const classCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    labels.forEach(label => {
        classCounts[label]++;
    });
    const totalSamples = labels.length;
    const numClasses = 4;
    // Compute balanced class weights
    // weight[class] = total_samples / (num_classes * count[class])
    const classWeights = {};
    for (let i = 0; i < numClasses; i++) {
        if (classCounts[i] > 0) {
            classWeights[i] = totalSamples / (numClasses * classCounts[i]);
        }
        else {
            classWeights[i] = 1.0;
        }
    }
    console.log('[ML Training] Class distribution:', classCounts);
    console.log('[ML Training] Calculated class weights:', classWeights);
    return classWeights;
}
/**
 * Convert verdict string to class index
 */
function verdictToClassIndex(verdict) {
    const mapping = {
        'legit': 0,
        'spam': 1,
        'promotion': 2,
        'clean': 3,
    };
    return mapping[verdict];
}
/**
 * Convert class index to verdict string
 */
function classIndexToVerdict(index) {
    const mapping = ['legit', 'spam', 'promotion', 'clean'];
    return mapping[index];
}
/**
 * Build neural network model
 * Phase 2: Advanced Neural Network Architecture
 */
function buildModel(numFeatures, modelType, dropoutRate) {
    const model = tf.sequential();
    if (modelType === 'linear') {
        // Simple linear model
        model.add(tf.layers.dense({
            inputShape: [numFeatures],
            units: 4,
            activation: 'softmax',
        }));
    }
    else if (modelType === 'neural_network') {
        // 3-layer neural network
        model.add(tf.layers.dense({
            inputShape: [numFeatures],
            units: 64,
            activation: 'relu',
            kernelInitializer: 'heNormal',
        }));
        model.add(tf.layers.dropout({ rate: dropoutRate }));
        model.add(tf.layers.dense({
            units: 32,
            activation: 'relu',
            kernelInitializer: 'heNormal',
        }));
        model.add(tf.layers.dropout({ rate: dropoutRate / 2 }));
        model.add(tf.layers.dense({
            units: 4,
            activation: 'softmax',
        }));
    }
    else {
        // Deep neural network (4+ layers)
        model.add(tf.layers.dense({
            inputShape: [numFeatures],
            units: 128,
            activation: 'relu',
            kernelInitializer: 'heNormal',
        }));
        model.add(tf.layers.batchNormalization());
        model.add(tf.layers.dropout({ rate: dropoutRate }));
        model.add(tf.layers.dense({
            units: 64,
            activation: 'relu',
            kernelInitializer: 'heNormal',
        }));
        model.add(tf.layers.batchNormalization());
        model.add(tf.layers.dropout({ rate: dropoutRate }));
        model.add(tf.layers.dense({
            units: 32,
            activation: 'relu',
            kernelInitializer: 'heNormal',
        }));
        model.add(tf.layers.dropout({ rate: dropoutRate / 2 }));
        model.add(tf.layers.dense({
            units: 4,
            activation: 'softmax',
        }));
    }
    return model;
}
/**
 * Compute per-class metrics (precision, recall, F1)
 */
function computePerClassMetrics(yTrue, yPred) {
    const metrics = {
        legit: { precision: 0, recall: 0, f1: 0 },
        spam: { precision: 0, recall: 0, f1: 0 },
        promotion: { precision: 0, recall: 0, f1: 0 },
        clean: { precision: 0, recall: 0, f1: 0 },
    };
    for (let classIdx = 0; classIdx < 4; classIdx++) {
        let tp = 0, fp = 0, fn = 0;
        for (let i = 0; i < yTrue.length; i++) {
            if (yTrue[i] === classIdx && yPred[i] === classIdx) {
                tp++;
            }
            else if (yTrue[i] !== classIdx && yPred[i] === classIdx) {
                fp++;
            }
            else if (yTrue[i] === classIdx && yPred[i] !== classIdx) {
                fn++;
            }
        }
        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        const verdict = classIndexToVerdict(classIdx);
        metrics[verdict] = { precision, recall, f1 };
    }
    return metrics;
}
/**
 * Train a new ML model from training data
 * This is the REAL implementation (no longer a stub!)
 */
async function trainModel(config = getDefaultTrainingConfig(), minSamples = 100, version) {
    const startTime = Date.now();
    console.log('[ML Training] ===== STARTING MODEL TRAINING =====');
    console.log('[ML Training] Config:', config);
    // ============================================================================
    // STEP 1: Load training data from database
    // ============================================================================
    console.log('[ML Training] Loading training examples from database...');
    const trainingExamples = await prisma_1.prisma.trainingExample.findMany({
        where: {
            is_validated: true, // Only use validated examples
            is_outlier: false, // Exclude outliers
        },
        orderBy: {
            created_at: 'desc',
        },
    });
    if (trainingExamples.length < minSamples) {
        throw new Error(`Insufficient training data: ${trainingExamples.length} samples (minimum: ${minSamples})`);
    }
    console.log(`[ML Training] Loaded ${trainingExamples.length} training examples`);
    // ============================================================================
    // STEP 2: Prepare features and labels
    // ============================================================================
    console.log('[ML Training] Preparing features and labels...');
    const features = [];
    const labels = [];
    let featureNames = [];
    for (const example of trainingExamples) {
        const exampleFeatures = example.features;
        // Extract feature vector (ensure consistent order)
        if (featureNames.length === 0) {
            featureNames = Object.keys(exampleFeatures);
        }
        const featureVector = featureNames.map(name => exampleFeatures[name] || 0);
        features.push(featureVector);
        // Convert label to class index
        labels.push(verdictToClassIndex(example.label));
    }
    const numFeatures = featureNames.length;
    console.log(`[ML Training] Extracted ${numFeatures} features per sample`);
    // ============================================================================
    // STEP 3: Train/Validation/Test split
    // ============================================================================
    console.log('[ML Training] Splitting data...');
    const numSamples = features.length;
    const numTest = Math.floor(numSamples * config.testSplit);
    const numVal = Math.floor(numSamples * config.validationSplit);
    const numTrain = numSamples - numTest - numVal;
    // Shuffle indices
    const indices = Array.from({ length: numSamples }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    // Split data
    const trainIndices = indices.slice(0, numTrain);
    const valIndices = indices.slice(numTrain, numTrain + numVal);
    const testIndices = indices.slice(numTrain + numVal);
    const X_train = trainIndices.map(i => features[i]);
    const y_train = trainIndices.map(i => labels[i]);
    const X_val = valIndices.map(i => features[i]);
    const y_val = valIndices.map(i => labels[i]);
    const X_test = testIndices.map(i => features[i]);
    const y_test = testIndices.map(i => labels[i]);
    console.log(`[ML Training] Split: ${numTrain} train, ${numVal} validation, ${numTest} test`);
    // ============================================================================
    // STEP 4: Calculate class weights (handle imbalance)
    // ============================================================================
    const classWeights = calculateClassWeights(y_train, config.classWeightsStrategy);
    // ============================================================================
    // STEP 5: Build model
    // ============================================================================
    console.log(`[ML Training] Building ${config.modelType} model...`);
    const model = buildModel(numFeatures, config.modelType, config.dropoutRate);
    // Compile model
    model.compile({
        optimizer: tf.train.adam(config.learningRate),
        loss: 'sparseCategoricalCrossentropy',
        metrics: ['accuracy'],
    });
    console.log('[ML Training] Model architecture:');
    model.summary();
    // ============================================================================
    // STEP 6: Train model
    // ============================================================================
    console.log('[ML Training] Training model...');
    const X_train_tensor = tf.tensor2d(X_train);
    const y_train_tensor = tf.tensor1d(y_train, 'int32');
    const X_val_tensor = tf.tensor2d(X_val);
    const y_val_tensor = tf.tensor1d(y_val, 'int32');
    // Create sample weights for class imbalance
    const sampleWeights = y_train.map(label => classWeights[label]);
    const sampleWeightsTensor = tf.tensor1d(sampleWeights);
    // Early stopping callback
    let bestValLoss = Infinity;
    let patienceCounter = 0;
    const trainingHistory = {
        loss: [],
        val_loss: [],
        accuracy: [],
        val_accuracy: [],
    };
    const history = await model.fit(X_train_tensor, y_train_tensor, {
        epochs: config.epochs,
        batchSize: config.batchSize,
        validationData: [X_val_tensor, y_val_tensor],
        sampleWeight: sampleWeightsTensor,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                console.log(`[ML Training] Epoch ${epoch + 1}/${config.epochs}: ` +
                    `loss=${logs?.loss.toFixed(4)}, acc=${logs?.acc.toFixed(4)}, ` +
                    `val_loss=${logs?.val_loss.toFixed(4)}, val_acc=${logs?.val_acc.toFixed(4)}`);
                // Track history
                trainingHistory.loss.push(logs?.loss || 0);
                trainingHistory.val_loss.push(logs?.val_loss || 0);
                trainingHistory.accuracy.push(logs?.acc || 0);
                trainingHistory.val_accuracy.push(logs?.val_acc || 0);
                // Early stopping
                if (logs?.val_loss < bestValLoss) {
                    bestValLoss = logs?.val_loss;
                    patienceCounter = 0;
                }
                else {
                    patienceCounter++;
                    if (patienceCounter >= config.earlyStoppingPatience) {
                        console.log(`[ML Training] Early stopping triggered at epoch ${epoch + 1}`);
                        model.stopTraining = true;
                    }
                }
            },
        },
    });
    // Clean up tensors
    X_train_tensor.dispose();
    y_train_tensor.dispose();
    X_val_tensor.dispose();
    y_val_tensor.dispose();
    sampleWeightsTensor.dispose();
    // ============================================================================
    // STEP 7: Evaluate on test set
    // ============================================================================
    console.log('[ML Training] Evaluating on test set...');
    const X_test_tensor = tf.tensor2d(X_test);
    const y_test_tensor = tf.tensor1d(y_test, 'int32');
    const testResults = model.evaluate(X_test_tensor, y_test_tensor);
    const testLoss = await testResults[0].data();
    const testAccuracy = await testResults[1].data();
    console.log(`[ML Training] Test loss: ${testLoss[0].toFixed(4)}`);
    console.log(`[ML Training] Test accuracy: ${testAccuracy[0].toFixed(4)}`);
    // Get predictions for per-class metrics
    const predictions = model.predict(X_test_tensor);
    const predictedClasses = (await predictions.argMax(-1).data());
    const perClassMetrics = computePerClassMetrics(y_test, Array.from(predictedClasses));
    console.log('[ML Training] Per-class metrics:', perClassMetrics);
    X_test_tensor.dispose();
    y_test_tensor.dispose();
    predictions.dispose();
    testResults.forEach(t => t.dispose());
    // ============================================================================
    // STEP 8: Save model to database
    // ============================================================================
    const modelVersion = version || `v${Date.now()}.0.0`;
    const trainingDurationMs = Date.now() - startTime;
    console.log(`[ML Training] Saving model as ${modelVersion}...`);
    const metrics = {
        accuracy: testAccuracy[0],
        loss: testLoss[0],
        validationLoss: trainingHistory.val_loss[trainingHistory.val_loss.length - 1],
        perClassMetrics,
    };
    const modelId = await (0, ml_model_storage_service_1.saveTensorFlowModel)(model, modelVersion, featureNames, metrics, numTrain, numVal, numTest, trainingDurationMs);
    console.log('[ML Training] ===== TRAINING COMPLETED =====');
    console.log(`[ML Training] Model ID: ${modelId}`);
    console.log(`[ML Training] Version: ${modelVersion}`);
    console.log(`[ML Training] Test Accuracy: ${(testAccuracy[0] * 100).toFixed(2)}%`);
    console.log(`[ML Training] Training Duration: ${(trainingDurationMs / 1000).toFixed(1)}s`);
    // Dispose model
    model.dispose();
    return {
        modelId,
        version: modelVersion,
        metrics,
        trainingHistory,
        classWeights: {
            legit: classWeights[0],
            spam: classWeights[1],
            promotion: classWeights[2],
            clean: classWeights[3],
        },
        trainingSamples: numTrain,
        validationSamples: numVal,
        testSamples: numTest,
        trainingDurationMs,
    };
}
/**
 * Store a training example for future model training
 */
async function storeTrainingExample(userId, messageId, features, label, originalVerdict, confidence, isCorrection = false) {
    const senderDomain = features.senderEmailDomain || 'unknown';
    const example = await prisma_1.prisma.trainingExample.create({
        data: {
            user_id: userId,
            message_id: messageId,
            features: features,
            label,
            original_verdict: originalVerdict,
            confidence,
            source: isCorrection ? 'user_correction' : 'initial_label',
            is_correction: isCorrection,
            sender_domain: senderDomain,
            is_validated: true, // Auto-validate for now (can add manual validation later)
            validation_score: confidence || 0.8,
        },
    });
    console.log(`[ML Training] Stored training example ${example.id} (label: ${label}, correction: ${isCorrection})`);
    return example.id;
}
/**
 * Get training statistics
 */
async function getTrainingStats() {
    const [total, byLabel, corrections, validated, outliers, recent] = await Promise.all([
        prisma_1.prisma.trainingExample.count(),
        prisma_1.prisma.trainingExample.groupBy({
            by: ['label'],
            _count: true,
        }),
        prisma_1.prisma.trainingExample.count({ where: { is_correction: true } }),
        prisma_1.prisma.trainingExample.count({ where: { is_validated: true } }),
        prisma_1.prisma.trainingExample.count({ where: { is_outlier: true } }),
        prisma_1.prisma.trainingExample.count({
            where: {
                created_at: {
                    gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
                },
            },
        }),
    ]);
    const byLabelMap = {
        legit: 0,
        spam: 0,
        promotion: 0,
        clean: 0,
    };
    byLabel.forEach(item => {
        byLabelMap[item.label] = item._count;
    });
    return {
        totalExamples: total,
        byLabel: byLabelMap,
        corrections,
        validated,
        outliers,
        recentExamples: recent,
    };
}
