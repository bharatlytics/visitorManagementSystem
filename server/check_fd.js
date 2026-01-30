try {
    const FormData = require('form-data');
    console.log('form-data loaded successfully');
    const form = new FormData();
    console.log('FormData instance created');
    console.log('Headers:', form.getHeaders());
} catch (e) {
    console.error('Error loading form-data:', e.message);
    try {
        console.log('Checking global FormData...');
        if (typeof FormData !== 'undefined') {
            const f = new FormData();
            console.log('Global FormData exists');
        } else {
            console.log('Global FormData NOT found');
        }
    } catch (e2) {
        console.error('Error checking global:', e2.message);
    }
}
