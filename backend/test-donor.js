const fetch = require('node-fetch');

async function testDonorRegistration() {
  try {
    const response = await fetch('http://localhost:4000/api/donors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'John Doe',
        bloodType: 'A+',
        city: 'New York',
        phone: '1234567890'
      })
    });

    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', data);

    // Test getting donors
    const getResponse = await fetch('http://localhost:4000/api/donors');
    const donors = await getResponse.json();
    console.log('All donors:', donors);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testDonorRegistration();
