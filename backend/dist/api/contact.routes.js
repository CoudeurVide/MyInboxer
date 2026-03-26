"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactRoutes = void 0;
const resend_1 = require("resend");
const config_1 = require("../lib/config");
const contactRoutes = async (fastify, opts) => {
    // Contact form submission
    fastify.post('/contact', async (request, reply) => {
        try {
            const { name, email, subject, message } = request.body;
            // Validate required fields
            if (!name || !email || !subject || !message) {
                return reply.status(400).send({
                    success: false,
                    error: 'All fields are required'
                });
            }
            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid email address'
                });
            }
            // Check if Resend API key is available
            const resendApiKey = process.env.RESEND_API_KEY || config_1.config.email.resend.apiKey;
            if (!resendApiKey) {
                fastify.log.error('Missing RESEND_API_KEY environment variable');
                // In development, we can simulate sending the email
                if (process.env.NODE_ENV === 'development') {
                    fastify.log.info('Simulated email sent (development mode):');
                    fastify.log.info(`To: ${process.env.CONTACT_EMAIL_RECIPIENT || 'contact@example.com'}`);
                    fastify.log.info(`Subject: Contact Form: ${subject}`);
                    fastify.log.info(`From: ${name} <${email}>`);
                    fastify.log.info(`Message: ${message}`);
                    return reply.status(200).send({
                        success: true,
                        message: 'Message sent successfully (simulated in development)'
                    });
                }
                else {
                    return reply.status(500).send({
                        success: false,
                        error: 'Email service not configured'
                    });
                }
            }
            // Initialize Resend with the API key
            const resend = new resend_1.Resend(resendApiKey);
            // Determine the from email address
            const fromEmail = process.env.EMAIL_FROM || config_1.config.email.resend.fromEmail || config_1.config.smtp.from || 'onboarding@resend.dev';
            // Send the email using Resend
            const { data, error } = await resend.emails.send({
                from: fromEmail, // Use configured from email
                to: process.env.CONTACT_EMAIL_RECIPIENT || 'contact@myinboxer.com', // Replace with your desired email
                subject: `Contact Form: ${subject}`,
                html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong></p>
          <p>${message}</p>
        `,
            });
            if (error) {
                fastify.log.error('Error sending email:', error);
                // Check if it's a domain verification error
                if (error.message && error.message.includes('verify a domain')) {
                    return reply.status(403).send({
                        success: false,
                        error: 'Email domain not verified. Please verify your domain at resend.com/domains.'
                    });
                }
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to send message'
                });
            }
            return reply.status(200).send({
                success: true,
                message: 'Message sent successfully'
            });
        }
        catch (error) {
            fastify.log.error('Unexpected error in contact form:', error);
            return reply.status(500).send({
                success: false,
                error: 'Internal server error'
            });
        }
    });
};
exports.contactRoutes = contactRoutes;
