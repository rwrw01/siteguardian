export function GET() {
	const body = [
		'Contact: mailto:security@publicvibes.nl',
		'Preferred-Languages: nl, en',
		'Canonical: https://siteguardian.publicvibes.nl/.well-known/security.txt',
		'Policy: https://siteguardian.publicvibes.nl/uitleg',
		'Expires: 2027-01-01T00:00:00.000Z',
	].join('\n');

	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}
